jest.mock('@octokit/rest', () => {
  const users = { getAuthenticated: jest.fn() };
  const rateLimit = { get: jest.fn() };
  const Octokit = jest.fn().mockImplementation(() => ({
    users,
    rateLimit,
  }));
  return { Octokit };
});

import { Octokit } from '@octokit/rest';
import { OctokitGitHubClient } from '../../src/modules/github/infrastructure/octokitGitHubClient';
import { Logger } from '../../src/shared/types/logger';
import { Clock } from '../../src/shared/types/clock';
import { GitHubAPIError } from '../../src/shared/types/errors';

function createMockLogger(): Logger {
  const noop = (..._: any[]) => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    withContext: () => createMockLogger(),
  };
}

function createMockClock(): Clock {
  return {
    now: () => new Date(),
    nowISO: () => new Date().toISOString(),
    nowUnix: () => Math.floor(Date.now() / 1000),
  };
}

function getMockedClient() {
  return (Octokit as unknown as jest.Mock).mock.results[
    (Octokit as unknown as jest.Mock).mock.results.length - 1
  ].value as {
    users: { getAuthenticated: jest.Mock };
    rateLimit: { get: jest.Mock };
  };
}

describe('OctokitGitHubClient.validateAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns valid when the authenticated user call succeeds', async () => {
    const client = new OctokitGitHubClient('good-pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({ data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } } });
    mock.users.getAuthenticated.mockResolvedValue({ data: { login: 'octocat' } });

    const result = await client.validateAuth();

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns invalid with Bad credentials on 401', async () => {
    const client = new OctokitGitHubClient('bad-pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({ data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } } });
    mock.users.getAuthenticated.mockRejectedValue({ status: 401, message: 'Bad credentials' });

    const result = await client.validateAuth();

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Bad credentials (401)');
  });

  it('returns invalid with Forbidden on 403', async () => {
    const client = new OctokitGitHubClient('bad-pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({ data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } } });
    mock.users.getAuthenticated.mockRejectedValue({ status: 403, message: 'SAML enforcement' });

    const result = await client.validateAuth();

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Forbidden (403)');
    expect(result.error).toContain('SAML enforcement');
  });

  it('returns invalid with mapped GitHubAPIError on 500', async () => {
    const client = new OctokitGitHubClient('pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({ data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } } });
    mock.users.getAuthenticated.mockRejectedValue({ status: 500, message: 'server exploded' });

    const result = await client.validateAuth();

    expect(result.valid).toBe(false);
    expect(result.error).toContain('500');
    expect(result.error).toContain('server exploded');
  });

  it('does not retry on failure (passes retries: 0)', async () => {
    const client = new OctokitGitHubClient('pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({ data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } } });
    mock.users.getAuthenticated.mockRejectedValue({ status: 401, message: 'Bad credentials' });

    await client.validateAuth();

    expect(mock.users.getAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('handles errors thrown as Error instances without status', async () => {
    const client = new OctokitGitHubClient('pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({ data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } } });
    mock.users.getAuthenticated.mockRejectedValue(new GitHubAPIError('network down', 500));

    const result = await client.validateAuth();

    expect(result.valid).toBe(false);
    expect(result.error).toContain('500');
    expect(result.error).toContain('network down');
  });
});
