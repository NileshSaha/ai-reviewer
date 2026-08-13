import { EventBus } from '../../events/application/eventBus';
import { ReviewRequestedEvent, ReviewCompletedEvent, ReviewFailedEvent, EVENT_TYPES } from '../../events/application/types';
import { GitHubClient } from '../../github/application/githubClient';
import { AIProvider, PRDetails, DiffContent } from '../../ai/application/aiProvider';
import { ReviewRepository } from '../application/reviewRepository';
import { Scorer, ScoringResult } from '../domain/scorer';
import { FileFilter } from '../domain/fileFilter';
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
      const files = await githubClient.getPullRequestFiles(owner, repo, prNumber);

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

      const reviewBody = buildReviewBody(decision, aiResult, aiProvider.name());
      const inlineComments = buildInlineComments(decision, aiResult.issues);

      const reviewInput: GitHubReviewInput = {
        body: reviewBody,
        event: decision.decision,
        comments: inlineComments.length > 0 ? inlineComments : undefined,
      };

      await githubClient.createReview(owner, repo, prNumber, reviewInput);
      log.info(`GitHub review posted`, {
        decision: decision.decision,
        score: aiResult.score,
        inline_comment_count: inlineComments.length,
        reason_truncated: decision.reason.substring(0, 100),
      });

      await reviewRepository.create({
        repository,
        prNumber,
        headSha: event.payload.headSha,
        reviewedAt: clock.now(),
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
  aiResult: { summary: string; strengths: string[]; issues: ReviewIssue[]; security: string | null; performance: string | null; overallComment: string },
  providerName: string
): string {
  const emoji = decision.decision === 'APPROVE' ? '✅' : '❌';
  const header = `## AI Based Code Review ${emoji}\n**Score:** ${decision.score}/100 | **Decision:** ${decision.decision}\n`;

  if (aiResult.overallComment) {
    return `${header}\n${aiResult.overallComment}\n\n---\n*AI Review powered by ${providerName}*`;
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
  if (decision.decision === 'APPROVE') {
    lines.push('This PR looks good to merge.');
  } else {
    lines.push('Please address the issues above before merging.');
  }
  lines.push('');

  lines.push('---', `*AI Review powered by ${providerName}*`);
  return lines.join('\n');
}

export function buildInlineComments(
  decision: ScoringResult,
  issues: ReviewIssue[]
): Array<{ path: string; line: number; body: string }> {
  if (decision.decision !== 'REQUEST_CHANGES') return [];

  const severityEmoji: Record<string, string> = { critical: '🔴', major: '🟡', minor: '🟢' };

  return issues
    .filter((issue) => issue.line && issue.line > 0)
    .map((issue) => {
      const icon = severityEmoji[issue.severity] ?? '🟢';
      const label = issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1);
      let body = `${icon} [${label}] ${issue.description}`;
      if (issue.suggestion) {
        body += `\n\n> **Suggestion:** ${issue.suggestion}`;
      }
      return { path: issue.file, line: issue.line!, body };
    });
}