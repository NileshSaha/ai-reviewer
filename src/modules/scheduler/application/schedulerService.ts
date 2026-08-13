import { GitHubClient } from '../../github/application/githubClient';
import { EventBus } from '../../events/application/eventBus';
import { ReviewRepository } from '../../review/application/reviewRepository';
import { RepositoryRepository } from '../../repository/application/repositoryRepository';
import { ReviewRequestedEvent, EVENT_TYPES } from '../../events/application/types';
import { RepositoryConfig } from '../../../config/types';
import { Logger } from '../../../shared/types/logger';
import { Clock } from '../../../shared/types/clock';
import { UUIDGenerator } from '../../../shared/types/uuid';

export interface SchedulerDeps {
  githubClient: GitHubClient;
  eventBus: EventBus;
  reviewRepository: ReviewRepository;
  repositoryRepository: RepositoryRepository;
  repositories: RepositoryConfig[];
  username: string;
  pollIntervalSeconds: number;
  concurrencyLimit: number;
  staggerDelaySeconds: number;
  cooldownMinutes: number;
  logger?: Logger;
  clock?: Clock;
  uuidGenerator?: UUIDGenerator;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const {
    githubClient,
    eventBus,
    reviewRepository,
    repositoryRepository,
    repositories,
    username,
    pollIntervalSeconds,
    concurrencyLimit,
    staggerDelaySeconds,
    cooldownMinutes,
  } = deps;

  const logger = deps.logger ?? createDefaultLogger();
  const clock = deps.clock ?? createDefaultClock();
  const uuidGenerator = deps.uuidGenerator ?? createDefaultUUID();

  let intervalId: NodeJS.Timeout | null = null;
  let isRunning = false;
  let activeRepositories: RepositoryConfig[] | null = null;

  interface ProcessedEntry {
    headSha: string;
    processedAt: number;
  }
  const processedPRs = new Map<string, ProcessedEntry>();

  async function getRepositories(): Promise<RepositoryConfig[]> {
    if (deps.repositories.length > 0) {
      if (activeRepositories !== null) return activeRepositories;
      activeRepositories = deps.repositories;
      logger.info(`Using ${activeRepositories.length} configured repositories`, {
        repositories: activeRepositories.map(r => `${r.owner}/${r.repo}`),
      });
      return activeRepositories;
    }

    return repositoryRepository.getPollable();
  }

  async function poll(): Promise<void> {
    if (isRunning) {
      logger.debug('Poll skipped - previous poll still in progress');
      return;
    }

    isRunning = true;
    const pollStartTime = clock.nowISO();

    try {
      const repos = await getRepositories();
      logger.info('Starting poll cycle', { pollStartTime, repositoryCount: repos.length });

      const allPRs: Array<{ repository: string; pr: any }> = [];

      const results = await Promise.allSettled(
        repos.map(async (repo) => {
          const repository = `${repo.owner}/${repo.repo}`;
          const prs = await githubClient.listPullRequestsWithReviewRequests(
            repo.owner, repo.repo, username
          );
          return { repository, prs };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { repository, prs } = result.value;
          logger.info(`Found ${prs.length} PRs with review requests in ${repository}`);

          for (const pr of prs) {
            allPRs.push({ repository, pr });
          }
        } else {
          logger.error('Failed to poll repository', {
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }

      logger.info(`Total PRs to process: ${allPRs.length}`);

      const currentKeys = new Set(allPRs.map(p => `${p.repository}#${p.pr.number}`));
      for (const key of processedPRs.keys()) {
        if (!currentKeys.has(key)) {
          processedPRs.delete(key);
        }
      }

      const processablePRs = allPRs.filter(item => {
        const key = `${item.repository}#${item.pr.number}`;
        const existing = processedPRs.get(key);
        if (!existing) {
          processedPRs.set(key, { headSha: item.pr.headSha, processedAt: Date.now() });
          return true;
        }
        if (existing.headSha !== item.pr.headSha) {
          existing.headSha = item.pr.headSha;
          return true;
        }
        return false;
      });

      if (processablePRs.length < allPRs.length) {
        logger.info(`Filtered to ${processablePRs.length} new/reappeared PRs (${allPRs.length - processablePRs.length} already processed)`);
      }

      const staggerMs = staggerDelaySeconds * 1000;
      for (let i = 0; i < processablePRs.length; i += concurrencyLimit) {
        const batch = processablePRs.slice(i, i + concurrencyLimit);
        await Promise.all(batch.map(item => processPullRequest(item.repository, item.pr)));

        if (i + concurrencyLimit < processablePRs.length && staggerMs > 0) {
          logger.debug(`Staggering ${staggerMs}ms before next batch`);
          await sleep(staggerMs);
        }
      }
    } catch (error) {
      logger.error('Poll cycle failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isRunning = false;
      logger.info('Poll cycle completed', {
        duration: `${clock.now().getTime() - new Date(pollStartTime).getTime()}ms`,
      });
    }
  }

  async function processPullRequest(repository: string, pr: any): Promise<void> {
    const correlationId = uuidGenerator.generateV4();

    const hasBeenReviewed = await reviewRepository.hasBeenReviewedWithSameSHA(
      repository,
      pr.number,
      pr.headSha
    );

    if (hasBeenReviewed) {
      logger.debug(`PR ${repository}#${pr.number} already reviewed with SHA ${pr.headSha}`, {
        correlation_id: correlationId,
      });
      return;
    }

    if (cooldownMinutes > 0) {
      const previousReview = await reviewRepository.findByRepoAndPR(repository, pr.number);
      if (previousReview) {
        const cooldownMs = cooldownMinutes * 60 * 1000;
        const reviewedAt = previousReview.reviewedAt instanceof Date
          ? previousReview.reviewedAt.getTime()
          : new Date(previousReview.reviewedAt).getTime();
        const elapsed = Date.now() - reviewedAt;

        if (elapsed < cooldownMs) {
          logger.warn(`PR ${repository}#${pr.number} reviewed ${Math.round(elapsed / 1000)}s ago (cooldown: ${cooldownMinutes}m). Skipping.`, {
            correlation_id: correlationId,
            previous_sha: previousReview.headSha,
            current_sha: pr.headSha,
            elapsed_seconds: Math.round(elapsed / 1000),
          });
          return;
        }

        if (previousReview.headSha !== pr.headSha && elapsed < cooldownMs * 3) {
          logger.warn(`Rapid re-review cycling detected for ${repository}#${pr.number}: SHA changed within ${Math.round(elapsed / 1000)}s`, {
            correlation_id: correlationId,
            previous_sha: previousReview.headSha,
            current_sha: pr.headSha,
            elapsed_seconds: Math.round(elapsed / 1000),
          });
        }
      }
    }

    logger.info(`Publishing ReviewRequested event for ${repository}#${pr.number}`, {
      correlation_id: correlationId,
      repository,
      pr_number: pr.number,
      author: pr.author.login,
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId,
        repository,
        prNumber: pr.number,
        prTitle: pr.title,
        prBody: pr.body,
        author: pr.author.login,
        baseBranch: pr.baseBranch,
        headBranch: pr.headBranch,
        headSha: pr.headSha,
        requestedAt: clock.nowISO(),
      },
    };

    await eventBus.publish(event);
  }

  return {
    start(): void {
      if (intervalId) {
        logger.warn('Scheduler already started');
        return;
      }

      logger.info(`Starting scheduler with ${pollIntervalSeconds}s interval`);

      (async () => {
        try {
          const allReviews = await reviewRepository.findAll();
          for (const review of allReviews) {
            const key = `${review.repository}#${review.prNumber}`;
            if (!processedPRs.has(key)) {
              processedPRs.set(key, {
                headSha: review.headSha,
                processedAt: review.reviewedAt instanceof Date
                  ? review.reviewedAt.getTime()
                  : new Date(review.reviewedAt).getTime(),
              });
            }
          }
          logger.info(`Seeded ${processedPRs.size} processed PRs from database`);
        } catch (error) {
          logger.warn('Failed to seed processed PRs from database', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        poll();
        intervalId = setInterval(poll, pollIntervalSeconds * 1000);
      })();
    },

    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info('Scheduler stopped');
      }
    },

    isRunning(): boolean {
      return intervalId !== null;
    },
  };
}

import { Logger as LoggerType } from '../../../shared/types/logger';
import { Clock as ClockType } from '../../../shared/types/clock';
import { UUIDGenerator as UUIDType } from '../../../shared/types/uuid';

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

function createDefaultUUID(): UUIDType {
  return {
    generate: () => Math.random().toString(36).substring(2),
    generateV4: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
