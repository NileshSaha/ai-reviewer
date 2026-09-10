import { EventBus } from '../../events/application/eventBus';
import { ReviewRequestedEvent, ReviewCompletedEvent, ReviewFailedEvent, EVENT_TYPES } from '../../events/application/types';
import { GitHubClient } from '../../github/application/githubClient';
import { AIProvider, PRDetails, DiffContent } from '../../ai/application/aiProvider';
import { ReviewRepository } from '../application/reviewRepository';
import { Scorer, ScoringResult } from '../domain/scorer';
import { FileFilter } from '../domain/fileFilter';
import { buildValidDiffLinesMap, normalizeFilePath } from '../domain/diffLineValidator';
import { Logger } from '../../../shared/types/logger';
import { Clock } from '../../../shared/types/clock';
import { GitHubReviewInput } from '../../github/domain/githubEntities';
import { ReviewIssue, ReviewDecision } from '../../ai/application/aiTypes';

export interface ReviewPipelineDeps {
  githubClient: GitHubClient;
  aiProvider: AIProvider;
  reviewRepository: ReviewRepository;
  eventBus: EventBus;
  approvalThreshold: number;
  skipReviewBelowScore?: number;
  logger?: Logger;
  clock?: Clock;
}

export function createReviewPipeline(deps: ReviewPipelineDeps) {
  const {
    githubClient,
    aiProvider,
    reviewRepository,
    eventBus,
    approvalThreshold,
    skipReviewBelowScore = 70,
  } = deps;

  const logger = deps.logger ?? createDefaultLogger();
  const clock = deps.clock ?? createDefaultClock();
  const scorer = new Scorer(approvalThreshold);
  const fileFilter = new FileFilter();

  async function handleReviewRequested(event: ReviewRequestedEvent): Promise<void> {
    const { correlationId, repository, prNumber } = event.payload;
    const log = logger.withContext({ correlation_id: correlationId, repository, pr_number: prNumber });

    log.info('Processing ReviewRequested event');

    try {
      const [owner, repo] = repository.split('/');

      const prDetails = await githubClient.getPullRequest(owner, repo, prNumber);
      const prFiles = await githubClient.getPullRequestFiles(owner, repo, prNumber);

      let files: any[] = prFiles;
      let lastReviewedSha: string | undefined;

      const previousReview = await reviewRepository.findByRepoAndPR(repository, prNumber);
      if (previousReview && previousReview.headSha !== event.payload.headSha) {
        try {
          log.info(`Fetching incremental changes between ${previousReview.headSha} and ${event.payload.headSha}`);
          const incFiles = await githubClient.compareCommits(owner, repo, previousReview.headSha, event.payload.headSha);

          // Intersect to filter out base branch merge commits
          const prFileNames = new Set(prFiles.map((f) => f.filename));
          files = incFiles.filter((f) => prFileNames.has(f.filename));
          lastReviewedSha = previousReview.headSha;

          log.debug(`Incremental files count: ${incFiles.length}. Intersected with PR files count: ${files.length}`);
        } catch (compareErr: any) {
          log.warn(`Failed to compare commits ${previousReview.headSha}...${event.payload.headSha}, falling back to full PR review`, {
            error: compareErr?.message ?? String(compareErr),
          });
          files = prFiles;
        }
      }

      // If no files left after intersection, it means the changes were purely merge-sync commits from the base branch
      if (files.length === 0) {
        log.info(`No new unique PR changes detected (only base branch merges/syncs). Skipping review.`);
        await reviewRepository.create({
          repository,
          prNumber,
          headSha: event.payload.headSha,
          reviewedAt: clock.now(),
          provider: 'skipped',
        });

        // Publish skipped event as completed
        const completedEvent: ReviewCompletedEvent = {
          type: EVENT_TYPES.REVIEW_COMPLETED,
          payload: {
            correlationId,
            repository,
            prNumber,
            decision: 'APPROVE',
            score: 100,
            commentsCount: 0,
            completedAt: clock.nowISO(),
          },
        };
        await eventBus.publish(completedEvent);
        return;
      }

      log.debug(`Fetched PR details and ${files.length} files`);

      const filteredFiles = fileFilter.filterFiles(files);
      log.info(`Filtered to ${filteredFiles.length} relevant files`, {
        originalCount: files.length,
        filteredCount: filteredFiles.length,
      });

      const diffContent: DiffContent = {
        files: filteredFiles.map((f) => ({
          filename: f.filename,
          patch: f.patch ?? null,
          status: f.status,
        })),
      };

      const prForAI: PRDetails = {
        repository,
        prNumber,
        title: prDetails.title,
        body: prDetails.body,
        author: prDetails.author.login,
        baseBranch: prDetails.baseBranch,
        headBranch: prDetails.headBranch,
        lastReviewedSha,
      };

      const aiResult = await aiProvider.generateReview(prForAI, diffContent);
      log.info(`AI review generated`, {
        score: aiResult.score,
        verdict: aiResult.verdict,
        strengths_count: aiResult.strengths.length,
        issues_count: aiResult.issues.length,
        critical_count: aiResult.issues.filter((i) => i.severity === 'critical').length,
        major_count: aiResult.issues.filter((i) => i.severity === 'major').length,
        minor_count: aiResult.issues.filter((i) => i.severity === 'minor').length,
        has_security_concern: aiResult.security !== null,
        has_perf_concern: aiResult.performance !== null,
      });

      const decision = scorer.decide(aiResult.score, aiResult.summary, aiResult.verdict);

      const githubEvent = mapDecisionToGitHubEvent(decision, aiResult);
      const hideScore = aiResult.score < skipReviewBelowScore;
      const reviewBody = buildReviewBody(decision, aiResult, aiProvider.name(), githubEvent, hideScore);

      // Calculate intersection of valid diff lines:
      const incrementalValidLinesMap = buildValidDiffLinesMap(filteredFiles);
      const prValidLinesMap = buildValidDiffLinesMap(fileFilter.filterFiles(prFiles));

      // Build valid inline lines map by intersecting them:
      const intersectedValidLinesMap = new Map<string, Set<number>>();
      for (const [filename, lines] of incrementalValidLinesMap.entries()) {
        const prLines = prValidLinesMap.get(filename);
        if (prLines) {
          const intersection = new Set([...lines].filter((x) => prLines.has(x)));
          if (intersection.size > 0) {
            intersectedValidLinesMap.set(filename, intersection);
          }
        }
      }

      const inlineComments = buildInlineComments(decision, aiResult.issues, intersectedValidLinesMap);

      if (decision.decision === 'REQUEST_CHANGES' && aiResult.issues.length > 0) {
        log.debug('Validated inline comments against diff hunks', {
          totalIssues: aiResult.issues.length,
          validInlineComments: inlineComments.length,
        });
      }

      const reviewInput: GitHubReviewInput = {
        body: reviewBody,
        event: githubEvent,
        comments: inlineComments.length > 0 ? inlineComments : undefined,
      };

      try {
        await githubClient.createReview(owner, repo, prNumber, reviewInput);
      } catch (reviewErr: any) {
        const errorMsg = reviewErr?.message || String(reviewErr);
        if (
          reviewInput.comments &&
          reviewInput.comments.length > 0 &&
          (errorMsg.includes('Line could not be resolved') ||
            errorMsg.includes('422') ||
            errorMsg.includes('Unprocessable Entity') ||
            errorMsg.includes('Validation Failed'))
        ) {
          log.warn(
            `Posting review with inline comments failed (${errorMsg}), retrying without inline comments`,
            { error: errorMsg }
          );
          reviewInput.comments = undefined;
          await githubClient.createReview(owner, repo, prNumber, reviewInput);
        } else {
          throw reviewErr;
        }
      }

      log.info(`GitHub review posted`, {
        decision: decision.decision,
        githubEvent,
        score: aiResult.score,
        hideScore,
        inline_comment_count: reviewInput.comments?.length ?? 0,
        reason_truncated: decision.reason.substring(0, 100),
      });

      await reviewRepository.create({
        repository,
        prNumber,
        headSha: event.payload.headSha,
        reviewedAt: clock.now(),
        provider: aiProvider.name(),
      });
      log.debug('Review state persisted');

      const completedEvent: ReviewCompletedEvent = {
        type: EVENT_TYPES.REVIEW_COMPLETED,
        payload: {
          correlationId,
          repository,
          prNumber,
          decision: decision.decision,
          score: aiResult.score,
          commentsCount: aiResult.comments.length + inlineComments.length,
          completedAt: clock.nowISO(),
        },
      };

      await eventBus.publish(completedEvent);
      log.info('ReviewCompleted event published');
    } catch (error) {
      log.error('Review pipeline failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      const failedEvent: ReviewFailedEvent = {
        type: EVENT_TYPES.REVIEW_FAILED,
        payload: {
          correlationId,
          repository,
          prNumber,
          error: error instanceof Error ? error.message : String(error),
          failedAt: clock.nowISO(),
        },
      };

      await eventBus.publish(failedEvent);
    }
  }

  return {
    handleReviewRequested,
    buildReviewBody,
    buildInlineComments,
    async subscribe(eventBus: EventBus): Promise<() => Promise<void>> {
      return eventBus.subscribe(EVENT_TYPES.REVIEW_REQUESTED, handleReviewRequested);
    },
  };
}

import { Logger as LoggerType } from '../../../shared/types/logger';
import { Clock as ClockType } from '../../../shared/types/clock';

function createDefaultLogger(): LoggerType {
  return {
    debug: (msg, ctx) => console.debug(`[DEBUG] ${msg}`, ctx),
    info: (msg, ctx) => console.info(`[INFO] ${msg}`, ctx),
    warn: (msg, ctx) => console.warn(`[WARN] ${msg}`, ctx),
    error: (msg, ctx) => console.error(`[ERROR] ${msg}`, ctx),
    withContext: (ctx) => createDefaultLogger(),
  };
}

function createDefaultClock(): ClockType {
  return {
    now: () => new Date(),
    nowISO: () => new Date().toISOString(),
    nowUnix: () => Math.floor(Date.now() / 1000),
  };
}

export function buildReviewBody(
  decision: ScoringResult,
  aiResult: { score?: number; summary: string; strengths: string[]; issues: ReviewIssue[]; security: string | null; performance: string | null; overallComment: string },
  providerName: string,
  githubEvent: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' = decision.decision as 'APPROVE' | 'REQUEST_CHANGES',
  hideScore: boolean = false
): string {
  const emoji = githubEvent === 'APPROVE' ? '✅' : githubEvent === 'REQUEST_CHANGES' ? '❌' : '💡';
  const statusLabel = deriveStatusLabel(githubEvent);
  const scoreLine = hideScore ? '' : `**Score:** ${decision.score}/100 | `;
  const header = `## AI Based Code Review ${emoji}\n${scoreLine}**Status:** ${statusLabel}\n`;

  let customComment = (aiResult.overallComment || '').trim();
  if (customComment) {
    customComment = customComment
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
      .replace(/<think>[\s\S]*$/gi, '')
      .replace(/<thought>[\s\S]*$/gi, '')
      .replace(/<reasoning>[\s\S]*$/gi, '')
      .trim();
  }

  if (customComment) {
    return `${header}\n${customComment}`;
  }

  const lines: string[] = [header, ''];

  lines.push('## 🔍 Code Review Summary', '');

  lines.push('### 📋 Overview', '', aiResult.summary, '');

  if (aiResult.strengths.length > 0) {
    lines.push('### ✅ Strengths', '');
    aiResult.strengths.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }

  if (aiResult.issues.length > 0) {
    const severityEmoji: Record<string, string> = { critical: '🔴', major: '🟡', minor: '🟢' };
    lines.push('### ⚠️ Issues Found', '', '| Severity | File | Line | Issue | Suggestion |', '|----------|------|------|-------|------------|');
    aiResult.issues.forEach((issue) => {
      const icon = severityEmoji[issue.severity] ?? '🟢';
      const file = `\`${issue.file}\``;
      const line = issue.line ? String(issue.line) : '—';
      lines.push(`| ${icon} ${issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1)} | ${file} | ${line} | ${issue.description} | ${issue.suggestion ?? '—'} |`);
    });
    lines.push('');
  }

  if (aiResult.security) {
    lines.push('### 🔒 Security', '', aiResult.security, '');
  } else if (aiResult.issues.length > 0) {
    lines.push('### 🔒 Security', '', 'No security concerns identified.', '');
  }

  if (aiResult.performance) {
    lines.push('### ⚡ Performance', '', aiResult.performance, '');
  } else if (aiResult.issues.length > 0) {
    lines.push('### ⚡ Performance', '', 'No performance concerns identified.', '');
  }

  lines.push('### 📝 Verdict', '');
  if (githubEvent === 'APPROVE') {
    lines.push('This PR looks good to merge.');
  } else if (githubEvent === 'REQUEST_CHANGES') {
    lines.push('Please address the issues above before merging.');
  } else {
    lines.push('Suggestions are provided above for consideration.');
  }

  return lines.join('\n');
}

export function mapDecisionToGitHubEvent(
  decision: ScoringResult,
  aiResult: { issues: ReviewIssue[]; security: string | null }
): 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' {
  if (decision.decision === 'APPROVE') {
    return 'APPROVE';
  }

  const hasCritical = aiResult.issues.some((issue) => issue.severity === 'critical') || aiResult.security !== null;

  return hasCritical ? 'REQUEST_CHANGES' : 'COMMENT';
}

export function deriveStatusLabel(githubEvent: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'): 'Approved' | 'Suggestions' | 'Changes Requested' {
  if (githubEvent === 'APPROVE') return 'Approved';
  if (githubEvent === 'REQUEST_CHANGES') return 'Changes Requested';
  return 'Suggestions';
}

export function buildInlineComments(
  decision: ScoringResult,
  issues: ReviewIssue[],
  validDiffLinesMap?: Map<string, Set<number>>
): Array<{ path: string; line: number; body: string }> {
  if (decision.decision !== 'REQUEST_CHANGES') return [];

  const severityEmoji: Record<string, string> = { critical: '🔴', major: '🟡', minor: '🟢' };

  return issues
    .filter((issue) => {
      if (!issue.line || issue.line <= 0 || !Number.isInteger(issue.line)) {
        return false;
      }
      if (validDiffLinesMap) {
        const normalized = normalizeFilePath(issue.file);
        const validLines = validDiffLinesMap.get(normalized);
        if (!validLines || !validLines.has(issue.line)) {
          return false;
        }
      }
      return true;
    })
    .map((issue) => {
      const icon = severityEmoji[issue.severity] ?? '🟢';
      const label = issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1);
      let body = `${icon} [${label}] ${issue.description}`;
      if (issue.suggestion) {
        body += `\n\n> **Suggestion:** ${issue.suggestion}`;
      }
      return { path: normalizeFilePath(issue.file), line: issue.line!, body };
    });
}