import { GitHubClient } from '../../github/application/githubClient';
import { AIProvider } from '../../ai/application/aiProvider';
import { Logger } from '../../../shared/types/logger';
import { Clock } from '../../../shared/types/clock';

export type CheckStatus = 'healthy' | 'unhealthy';

export interface ComponentCheck {
  status: CheckStatus;
  latencySeconds: number;
  error?: string;
}

export interface GitHubCheck extends ComponentCheck {
  status: CheckStatus;
  latencySeconds: number;
  error?: string;
}

export interface AICheck extends ComponentCheck {
  provider: string;
  status: CheckStatus;
  latencySeconds: number;
  error?: string;
}

export interface HealthReport {
  status: CheckStatus;
  timestamp: string;
  checks: {
    github: GitHubCheck;
    ai: AICheck;
  };
}

export interface HealthCheckerDeps {
  githubClient: GitHubClient;
  aiProvider: AIProvider;
  logger: Logger;
  clock: Clock;
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 30;

export function createHealthChecker(deps: HealthCheckerDeps): () => Promise<HealthReport> {
  const ttl = deps.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  let cached: { expiresAt: number; report: HealthReport } | null = null;

  async function runTimed<T>(label: string, fn: () => Promise<T>): Promise<{ value?: T; latencySeconds: number; error?: string }> {
    const startedAt = deps.clock.nowUnix();
    try {
      const value = await fn();
      const latencySeconds = Math.max(0, deps.clock.nowUnix() - startedAt);
      deps.logger.debug(`Health check '${label}' ok`, { module: 'health', latencySeconds });
      return { value, latencySeconds };
    } catch (error) {
      const latencySeconds = Math.max(0, deps.clock.nowUnix() - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.warn(`Health check '${label}' failed`, { module: 'health', latencySeconds, error: message });
      return { latencySeconds, error: message };
    }
  }

  return async function check(): Promise<HealthReport> {
    const now = deps.clock.nowUnix();
    if (cached && cached.expiresAt > now) {
      return cached.report;
    }

    const [githubResult, aiResult] = await Promise.all([
      runTimed('github', () => deps.githubClient.validateAuth()),
      runTimed('ai', () => deps.aiProvider.validateApiKey()),
    ]);

    let githubCheck: GitHubCheck;
    if (githubResult.value !== undefined && githubResult.error === undefined) {
      const v = githubResult.value;
      if (v.valid) {
        githubCheck = { status: 'healthy', latencySeconds: githubResult.latencySeconds };
      } else {
        githubCheck = { status: 'unhealthy', latencySeconds: githubResult.latencySeconds, error: v.error };
      }
    } else {
      githubCheck = { status: 'unhealthy', latencySeconds: githubResult.latencySeconds, error: githubResult.error };
    }

    let aiCheck: AICheck;
    if (aiResult.value !== undefined && aiResult.error === undefined) {
      const v = aiResult.value;
      if (v.valid) {
        aiCheck = { provider: deps.aiProvider.name(), status: 'healthy', latencySeconds: aiResult.latencySeconds };
      } else {
        aiCheck = { provider: deps.aiProvider.name(), status: 'unhealthy', latencySeconds: aiResult.latencySeconds, error: v.error };
      }
    } else {
      aiCheck = { provider: deps.aiProvider.name(), status: 'unhealthy', latencySeconds: aiResult.latencySeconds, error: aiResult.error };
    }

    const report: HealthReport = {
      status: githubCheck.status === 'healthy' && aiCheck.status === 'healthy' ? 'healthy' : 'unhealthy',
      timestamp: deps.clock.nowISO(),
      checks: {
        github: githubCheck,
        ai: aiCheck,
      },
    };

    cached = { expiresAt: now + ttl, report };
    return report;
  };
}
