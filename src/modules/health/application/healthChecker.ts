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

export interface IndividualAICheck {
  name: string;
  status: CheckStatus;
  latencySeconds: number;
  error?: string;
}

export interface AICheck extends ComponentCheck {
  provider: string;
  status: CheckStatus;
  latencySeconds: number;
  error?: string;
  providers?: IndividualAICheck[];
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

    // Extract individual providers if wrapped in FallbackAIProvider
    const entries: Array<{ name: string; provider: AIProvider }> =
      typeof (deps.aiProvider as any).getEntries === 'function'
        ? (deps.aiProvider as any).getEntries()
        : [{ name: deps.aiProvider.name(), provider: deps.aiProvider }];

    const [githubResult, ...aiResults] = await Promise.all([
      runTimed('github', () => deps.githubClient.validateAuth()),
      ...entries.map((entry) =>
        runTimed(`ai:${entry.name}`, () => entry.provider.validateApiKey()).then((res) => ({
          name: entry.name,
          ...res,
        }))
      ),
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

    const individualChecks: IndividualAICheck[] = aiResults.map((res) => {
      if (res.value !== undefined && res.error === undefined) {
        if (res.value.valid) {
          return { name: res.name, status: 'healthy' as CheckStatus, latencySeconds: res.latencySeconds };
        }
        return {
          name: res.name,
          status: 'unhealthy' as CheckStatus,
          latencySeconds: res.latencySeconds,
          error: res.value.error,
        };
      }
      return {
        name: res.name,
        status: 'unhealthy' as CheckStatus,
        latencySeconds: res.latencySeconds,
        error: res.error,
      };
    });

    const anyAiHealthy = individualChecks.some((c) => c.status === 'healthy');
    const maxAiLatency = individualChecks.reduce((max, c) => Math.max(max, c.latencySeconds), 0);
    const firstError = individualChecks.find((c) => c.error)?.error;

    const aiCheck: AICheck = {
      provider: deps.aiProvider.name(),
      status: anyAiHealthy ? 'healthy' : 'unhealthy',
      latencySeconds: maxAiLatency,
      error: anyAiHealthy ? undefined : firstError,
      providers: individualChecks,
    };

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
