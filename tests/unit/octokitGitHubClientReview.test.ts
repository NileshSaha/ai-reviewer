jest.mock('@octokit/rest', () => {
  const users = { getAuthenticated: jest.fn() };
  const rateLimit = { get: jest.fn() };
  const pulls = {
    createReview: jest.fn(),
    get: jest.fn(),
    listFiles: jest.fn(),
  };
  const Octokit = jest.fn().mockImplementation(() => ({
    users,
    rateLimit,
    pulls,
  }));
  return { Octokit };
});

import { Octokit } from '@octokit/rest';
import { OctokitGitHubClient } from '../../src/modules/github/infrastructure/octokitGitHubClient';
import { Logger } from '../../src/shared/types/logger';
import { Clock } from '../../src/shared/types/clock';

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
    now: () => new Date('2026-08-19T10:00:00Z'),
    nowISO: () => '2026-08-19T10:00:00.000Z',
    nowUnix: () => 1787133600,
  };
}

function getMockedClient() {
  return (Octokit as unknown as jest.Mock).mock.results[
    (Octokit as unknown as jest.Mock).mock.results.length - 1
  ].value as {
    users: { getAuthenticated: jest.Mock };
    rateLimit: { get: jest.Mock };
    pulls: {
      createReview: jest.Mock;
      get: jest.Mock;
      listFiles: jest.Mock;
    };
  };
}

describe('OctokitGitHubClient.createReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('posts review with comments successfully', async () => {
    const client = new OctokitGitHubClient('pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({
      data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } },
    });
    mock.pulls.createReview.mockResolvedValue({
      data: {
        id: 101,
        user: { login: 'reviewer-bot', id: 1, avatar_url: 'https://avatar' },
        body: 'LGTM',
        submitted_at: '2026-08-19T10:00:00Z',
      },
    });

    const result = await client.createReview('owner', 'repo', 1, {
      body: 'LGTM',
      event: 'APPROVE',
      comments: [{ path: 'src/a.ts', line: 10, body: 'Nice' }],
    });

    expect(result.id).toBe(101);
    expect(mock.pulls.createReview).toHaveBeenCalledTimes(1);
    expect(mock.pulls.createReview).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 1,
      body: 'LGTM',
      event: 'APPROVE',
      comments: [{ path: 'src/a.ts', line: 10, body: 'Nice' }],
    });
  });

  it('falls back to creating review without comments when 422 Line could not be resolved occurs', async () => {
    const client = new OctokitGitHubClient('pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({
      data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } },
    });

    // First call with comments fails with 422
    mock.pulls.createReview
      .mockRejectedValueOnce({
        status: 422,
        message: 'Unprocessable Entity: "Line could not be resolved" - https://docs.github.com/rest/pulls/reviews#create-a-review-for-a-pull-request',
      })
      // Second call without comments succeeds
      .mockResolvedValueOnce({
        data: {
          id: 102,
          user: { login: 'reviewer-bot', id: 1, avatar_url: 'https://avatar' },
          body: 'Review body',
          submitted_at: '2026-08-19T10:00:00Z',
        },
      });

    const result = await client.createReview('owner', 'repo', 32, {
      body: 'Review body',
      event: 'REQUEST_CHANGES',
      comments: [{ path: 'src/invalid.ts', line: 999, body: 'Unresolvable line' }],
    });

    expect(result.id).toBe(102);
    expect(mock.pulls.createReview).toHaveBeenCalledTimes(2);
    // Second invocation has no comments
    expect(mock.pulls.createReview).toHaveBeenLastCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 32,
      body: 'Review body',
      event: 'REQUEST_CHANGES',
    });
  });

  it('re-throws non-comment errors like 404 or 403', async () => {
    const client = new OctokitGitHubClient('pat', createMockLogger(), createMockClock());
    const mock = getMockedClient();
    mock.rateLimit.get.mockResolvedValue({
      data: { rate: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } },
    });
    mock.pulls.createReview.mockRejectedValue({
      status: 404,
      message: 'Not Found',
    });

    await expect(
      client.createReview('owner', 'repo', 1, {
        body: 'Body',
        event: 'COMMENT',
      })
    ).rejects.toThrow();
  });
});
