import { createHealthChecker } from '../../src/modules/health/application/healthChecker';
import { GitHubClient } from '../../src/modules/github/application/githubClient';
import { AIProvider } from '../../src/modules/ai/application/aiProvider';
import { Logger } from '../../src/shared/types/logger';
import { Clock } from '../../src/shared/types/clock';

interface MockLogger extends Logger {
  calls: { level: string; message: string; context?: Record<string, unknown> }[];
}

function createMockLogger(): MockLogger {
  const calls: MockLogger['calls'] = [];
  const noop = () => {};
  const rec = (level: string) => (message: string, context?: Record<string, unknown>) => {
    calls.push({ level, message, context });
  };
  const logger: MockLogger = {
    debug: rec('debug'),
    info: rec('info'),
    warn: rec('warn'),
    error: rec('error'),
    withContext: () => logger,
    calls,
  };
  return logger;
}

interface MockClock extends Clock {
  current: number;
}

function createMockClock(start = 1_700_000_000): MockClock {
  const clock: MockClock = {
    current: start,
    now: () => new Date(clock.current * 1000),
    nowISO: () => new Date(clock.current * 1000).toISOString(),
    nowUnix: () => clock.current,
  };
  return clock;
}

function createMockGitHub(impl: GitHubClient['validateAuth']): { client: GitHubClient; calls: () => number } {
  const fn = jest.fn(impl);
  const client: Partial<GitHubClient> = {
    validateAuth: fn,
  };
  return { client: client as GitHubClient, calls: () => fn.mock.calls.length };
}

function createMockAI(impl: AIProvider['validateApiKey'], providerName = 'groq'): { provider: AIProvider; calls: () => number } {
  const fn = jest.fn(impl);
  const provider: Partial<AIProvider> = {
    validateApiKey: fn,
    name: () => providerName,
    generateReview: jest.fn(),
  };
  return { provider: provider as AIProvider, calls: () => fn.mock.calls.length };
}

describe('createHealthChecker', () => {
  it('returns healthy when both GitHub and AI are valid', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: true }));
    const ai = createMockAI(async () => ({ valid: true }));

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.status).toBe('healthy');
    expect(report.checks.github.status).toBe('healthy');
    expect(report.checks.ai.status).toBe('healthy');
    expect(report.checks.ai.provider).toBe('groq');
    expect(report.checks.github.error).toBeUndefined();
    expect(report.checks.ai.error).toBeUndefined();
    expect(typeof report.timestamp).toBe('string');
  });

  it('returns unhealthy when GitHub auth is invalid', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: false, error: 'Bad credentials (401)' }));
    const ai = createMockAI(async () => ({ valid: true }));

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.status).toBe('unhealthy');
    expect(report.checks.github.status).toBe('unhealthy');
    expect(report.checks.github.error).toBe('Bad credentials (401)');
    expect(report.checks.ai.status).toBe('healthy');
  });

  it('returns unhealthy when AI key is invalid', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: true }));
    const ai = createMockAI(async () => ({ valid: false, error: 'Auth failed (401)' }));

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.status).toBe('unhealthy');
    expect(report.checks.ai.status).toBe('unhealthy');
    expect(report.checks.ai.error).toBe('Auth failed (401)');
    expect(report.checks.github.status).toBe('healthy');
  });

  it('returns unhealthy when both checks fail', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: false, error: 'Bad credentials (401)' }));
    const ai = createMockAI(async () => ({ valid: false, error: 'Auth failed (401)' }));

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.status).toBe('unhealthy');
    expect(report.checks.github.status).toBe('unhealthy');
    expect(report.checks.ai.status).toBe('unhealthy');
  });

  it('captures thrown errors from GitHub validateAuth as unhealthy', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => {
      throw new Error('network down');
    });
    const ai = createMockAI(async () => ({ valid: true }));

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.status).toBe('unhealthy');
    expect(report.checks.github.status).toBe('unhealthy');
    expect(report.checks.github.error).toBe('network down');
    expect(report.checks.ai.status).toBe('healthy');
  });

  it('captures thrown errors from AI validateApiKey as unhealthy', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: true }));
    const ai = createMockAI(async () => {
      throw new Error('fetch failed');
    });

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.status).toBe('unhealthy');
    expect(report.checks.ai.status).toBe('unhealthy');
    expect(report.checks.ai.error).toBe('fetch failed');
  });

  it('runs both checks in parallel', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    let concurrent = 0;
    let maxConcurrent = 0;
    const githubFn = jest.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 30));
      concurrent--;
      return { valid: true };
    });
    const aiFn = jest.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 30));
      concurrent--;
      return { valid: true };
    });

    const check = createHealthChecker({
      githubClient: { validateAuth: githubFn } as unknown as GitHubClient,
      aiProvider: { validateApiKey: aiFn, name: () => 'groq', generateReview: jest.fn() } as unknown as AIProvider,
      logger,
      clock,
    });

    await check();

    expect(maxConcurrent).toBe(2);
  });

  it('caches results within TTL — second call does not invoke deps', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: true }));
    const ai = createMockAI(async () => ({ valid: true }));

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
      ttlSeconds: 30,
    });

    await check();
    await check();
    await check();

    expect(github.calls()).toBe(1);
    expect(ai.calls()).toBe(1);
  });

  it('re-validates after TTL expires', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: true }));
    const ai = createMockAI(async () => ({ valid: true }));

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
      ttlSeconds: 30,
    });

    await check();
    expect(github.calls()).toBe(1);

    clock.current += 31;

    await check();
    expect(github.calls()).toBe(2);
    expect(ai.calls()).toBe(2);
  });

  it('measures latency between startedAt and now', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => {
      const target = clock.current + 5;
      while (clock.current < target) clock.current++;
      return { valid: true };
    });
    const ai = createMockAI(async () => ({ valid: true }));

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.checks.github.latencySeconds).toBe(5);
  });

  it('reports active AI provider name in the ai check', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: true }));
    const ai = createMockAI(async () => ({ valid: true }), 'openai');

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: ai.provider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.checks.ai.provider).toBe('openai');
  });

  it('lists individual provider healths and is healthy if any provider works', async () => {
    const clock = createMockClock();
    const logger = createMockLogger();
    const github = createMockGitHub(async () => ({ valid: true }));

    const p1 = createMockAI(async () => ({ valid: false, error: 'Auth failed (401)' }), 'minimax');
    const p2 = createMockAI(async () => ({ valid: true }), 'groq');

    const fallbackProvider: any = {
      name: () => 'minimax (fallback: groq)',
      validateApiKey: jest.fn().mockResolvedValue({ valid: true }),
      generateReview: jest.fn(),
      getEntries: () => [
        { name: 'minimax', provider: p1.provider },
        { name: 'groq', provider: p2.provider },
      ],
    };

    const check = createHealthChecker({
      githubClient: github.client,
      aiProvider: fallbackProvider,
      logger,
      clock,
    });

    const report = await check();

    expect(report.status).toBe('healthy');
    expect(report.checks.ai.status).toBe('healthy');
    expect(report.checks.ai.providers).toBeDefined();
    expect(report.checks.ai.providers).toHaveLength(2);
    expect(report.checks.ai.providers![0]).toMatchObject({
      name: 'minimax',
      status: 'unhealthy',
      error: 'Auth failed (401)',
    });
    expect(report.checks.ai.providers![1]).toMatchObject({
      name: 'groq',
      status: 'healthy',
    });
  });
});
