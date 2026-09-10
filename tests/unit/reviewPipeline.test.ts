import { createReviewPipeline } from '../../src/modules/review/application/reviewPipeline';
import { EVENT_TYPES, ReviewRequestedEvent } from '../../src/modules/events/application/types';
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
  const d = new Date('2026-08-19T10:00:00Z');
  return {
    now: () => d,
    nowISO: () => d.toISOString(),
    nowUnix: () => Math.floor(d.getTime() / 1000),
  };
}

describe('ReviewPipeline', () => {
  const mockEventBus = {
    publish: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    clearAll: jest.fn(),
  };

  const mockReviewRepository = {
    create: jest.fn().mockResolvedValue(undefined),
    findByRepoAndPR: jest.fn(),
    hasBeenReviewedWithSameSHA: jest.fn().mockResolvedValue(false),
    delete: jest.fn(),
  };

  const mockGitHubClient = {
    getAuthenticatedUser: jest.fn(),
    getRepository: jest.fn(),
    listCollaboratorRepositories: jest.fn(),
    listPullRequestsWithReviewRequests: jest.fn(),
    getPullRequest: jest.fn().mockResolvedValue({
      number: 32,
      title: 'Fix issue',
      body: 'Some details',
      author: { login: 'dev-user', id: 1, avatarUrl: '' },
      baseBranch: 'main',
      headBranch: 'feat/test',
      headSha: 'abc12345',
      state: 'open',
      isDraft: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      requestedReviewers: [],
    }),
    getPullRequestFiles: jest.fn().mockResolvedValue([
      {
        filename: 'src/app.ts',
        status: 'modified',
        additions: 5,
        deletions: 2,
        patch: '@@ -10,4 +10,5 @@\n context\n+new line 11\n+new line 12\n context',
      },
    ]),
    compareCommits: jest.fn().mockResolvedValue([
      {
        filename: 'src/app.ts',
        status: 'modified',
        additions: 5,
        deletions: 2,
        patch: '@@ -10,4 +10,5 @@\n context\n+new line 11\n+new line 12\n context',
      },
    ]),
    getPullRequestDiff: jest.fn(),
    createReview: jest.fn().mockResolvedValue({
      id: 1,
      user: { login: 'reviewer-bot', id: 1, avatarUrl: '' },
      body: 'Review body',
      event: 'REQUEST_CHANGES',
      submittedAt: new Date(),
    }),
    getRateLimitStatus: jest.fn(),
    validateAuth: jest.fn(),
  };

  const mockAIProvider = {
    name: () => 'groq',
    generateReview: jest.fn().mockResolvedValue({
      score: 50,
      summary: 'Needs fixes',
      verdict: 'REQUEST_CHANGES',
      strengths: [],
      issues: [
        { severity: 'critical', file: 'src/app.ts', line: 11, description: 'Valid line issue' },
        { severity: 'major', file: 'src/app.ts', line: 999, description: 'Line outside diff' },
        { severity: 'minor', file: 'src/unrelated.ts', line: 5, description: 'File not changed' },
      ],
      security: null,
      performance: null,
      comments: [],
      overallComment: '',
    }),
    validateApiKey: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters inline comments to only lines present in diff hunks', async () => {
    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-123',
        repository: 'codelogicx/servicestation-tenant-frontend',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: 'Some details',
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    expect(mockGitHubClient.createReview).toHaveBeenCalledTimes(1);
    const reviewInputArg = mockGitHubClient.createReview.mock.calls[0][3];
    expect(reviewInputArg.event).toBe('REQUEST_CHANGES');
    expect(reviewInputArg.body).toContain('**Status:** Changes Requested');
    expect(reviewInputArg.body).not.toContain('**Score:**');
    expect(reviewInputArg.comments).toHaveLength(1);
    expect(reviewInputArg.comments[0].line).toBe(11);
    expect(reviewInputArg.comments[0].path).toBe('src/app.ts');

    expect(mockReviewRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'codelogicx/servicestation-tenant-frontend',
        prNumber: 32,
        headSha: 'abc12345',
        provider: 'groq',
      })
    );

    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EVENT_TYPES.REVIEW_COMPLETED,
      })
    );
  });

  it('falls back to posting review without comments if createReview throws line resolution error', async () => {
    mockGitHubClient.createReview
      .mockRejectedValueOnce(new Error('Unprocessable Entity: "Line could not be resolved"'))
      .mockResolvedValueOnce({
        id: 2,
        user: { login: 'reviewer-bot', id: 1, avatarUrl: '' },
        body: 'Review body',
        event: 'REQUEST_CHANGES',
        submittedAt: new Date(),
      });

    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-123',
        repository: 'codelogicx/servicestation-tenant-frontend',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: 'Some details',
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    expect(mockGitHubClient.createReview).toHaveBeenCalledTimes(2);
    // Second call has no comments
    expect(mockGitHubClient.createReview.mock.calls[1][3].comments).toBeUndefined();

    expect(mockReviewRepository.create).toHaveBeenCalled();
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: EVENT_TYPES.REVIEW_COMPLETED,
      })
    );
  });

  it('runs incremental review when a previous review with a different SHA exists', async () => {
    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    mockReviewRepository.findByRepoAndPR.mockResolvedValueOnce({
      id: 'prev-id',
      repository: 'owner/repo',
      prNumber: 32,
      headSha: 'old-sha-123',
      reviewedAt: new Date(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-correlation-id',
        repository: 'owner/repo',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: 'Some details',
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    expect(mockGitHubClient.compareCommits).toHaveBeenCalledWith('owner', 'repo', 'old-sha-123', 'abc12345');
    expect(mockAIProvider.generateReview).toHaveBeenCalled();
    expect(mockReviewRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'groq',
      })
    );
  });

  it('skips review when intersection of incremental files and PR files is empty (merge-only sync)', async () => {
    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    // Mock compareCommits returning a file not in getPullRequestFiles (only in base branch)
    mockGitHubClient.compareCommits.mockResolvedValueOnce([
      {
        filename: 'some/other/file.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch: '@@ -1,1 +1,1 @@\n-old\n+new',
      },
    ]);

    mockReviewRepository.findByRepoAndPR.mockResolvedValueOnce({
      id: 'prev-id',
      repository: 'owner/repo',
      prNumber: 32,
      headSha: 'old-sha-123',
      reviewedAt: new Date(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-correlation-id',
        repository: 'owner/repo',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: 'Some details',
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    // AI should not be called
    expect(mockAIProvider.generateReview).not.toHaveBeenCalled();
    // Record should be persisted as skipped
    expect(mockReviewRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'skipped',
      })
    );
  });

  it('posts COMMENT event with score hidden when score < skipReviewBelowScore and no critical issues', async () => {
    mockAIProvider.generateReview.mockResolvedValueOnce({
      score: 65,
      summary: 'Minor issues',
      verdict: 'REQUEST_CHANGES',
      strengths: [],
      issues: [
        { severity: 'major', file: 'src/app.ts', line: 11, description: 'Variable naming' },
      ],
      security: null,
      performance: null,
      comments: [],
      overallComment: '',
    });

    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      skipReviewBelowScore: 70,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-123',
        repository: 'owner/repo',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: null,
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    expect(mockGitHubClient.createReview).toHaveBeenCalledTimes(1);
    const reviewInputArg = mockGitHubClient.createReview.mock.calls[0][3];
    expect(reviewInputArg.event).toBe('COMMENT');
    expect(reviewInputArg.body).toContain('**Status:** Suggestions');
    expect(reviewInputArg.body).not.toContain('**Score:**');
    expect(reviewInputArg.body).not.toContain('REQUEST_CHANGES');
  });

  it('posts REQUEST_CHANGES event with score hidden when score < threshold but critical issue exists', async () => {
    mockAIProvider.generateReview.mockResolvedValueOnce({
      score: 55,
      summary: 'Critical security issue',
      verdict: 'REQUEST_CHANGES',
      strengths: [],
      issues: [
        { severity: 'critical', file: 'src/app.ts', line: 11, description: 'SQL injection' },
      ],
      security: null,
      performance: null,
      comments: [],
      overallComment: '',
    });

    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      skipReviewBelowScore: 70,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-123',
        repository: 'owner/repo',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: null,
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    expect(mockGitHubClient.createReview).toHaveBeenCalledTimes(1);
    const reviewInputArg = mockGitHubClient.createReview.mock.calls[0][3];
    expect(reviewInputArg.event).toBe('REQUEST_CHANGES');
    expect(reviewInputArg.body).toContain('**Status:** Changes Requested');
    expect(reviewInputArg.body).not.toContain('**Score:**');
  });

  it('posts COMMENT event with score shown when score 70-79 and no critical issues', async () => {
    mockAIProvider.generateReview.mockResolvedValueOnce({
      score: 72,
      summary: 'Almost there',
      verdict: 'REQUEST_CHANGES',
      strengths: [],
      issues: [
        { severity: 'major', file: 'src/app.ts', line: 11, description: 'Naming' },
      ],
      security: null,
      performance: null,
      comments: [],
      overallComment: '',
    });

    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      skipReviewBelowScore: 70,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-123',
        repository: 'owner/repo',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: null,
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    expect(mockGitHubClient.createReview).toHaveBeenCalledTimes(1);
    const reviewInputArg = mockGitHubClient.createReview.mock.calls[0][3];
    expect(reviewInputArg.event).toBe('COMMENT');
    expect(reviewInputArg.body).toContain('**Status:** Suggestions');
    expect(reviewInputArg.body).toContain('**Score:** 72/100');
  });

  it('posts REQUEST_CHANGES event with score shown when score 70-79 and critical issue exists', async () => {
    mockAIProvider.generateReview.mockResolvedValueOnce({
      score: 75,
      summary: 'Critical issue blocks merge',
      verdict: 'REQUEST_CHANGES',
      strengths: [],
      issues: [
        { severity: 'critical', file: 'src/app.ts', line: 11, description: 'Hardcoded key' },
      ],
      security: null,
      performance: null,
      comments: [],
      overallComment: '',
    });

    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      skipReviewBelowScore: 70,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-123',
        repository: 'owner/repo',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: null,
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    expect(mockGitHubClient.createReview).toHaveBeenCalledTimes(1);
    const reviewInputArg = mockGitHubClient.createReview.mock.calls[0][3];
    expect(reviewInputArg.event).toBe('REQUEST_CHANGES');
    expect(reviewInputArg.body).toContain('**Status:** Changes Requested');
    expect(reviewInputArg.body).toContain('**Score:** 75/100');
  });

  it('posts APPROVE event when score meets threshold and AI approves', async () => {
    mockAIProvider.generateReview.mockResolvedValueOnce({
      score: 92,
      summary: 'Looks good',
      verdict: 'APPROVE',
      strengths: ['Clean code'],
      issues: [],
      security: null,
      performance: null,
      comments: [],
      overallComment: '',
    });

    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      skipReviewBelowScore: 70,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-123',
        repository: 'owner/repo',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: null,
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    expect(mockGitHubClient.createReview).toHaveBeenCalledTimes(1);
    const reviewInputArg = mockGitHubClient.createReview.mock.calls[0][3];
    expect(reviewInputArg.event).toBe('APPROVE');
    expect(reviewInputArg.body).toContain('**Status:** Approved');
    expect(reviewInputArg.body).toContain('**Score:** 92/100');
  });

  it('uses default skipReviewBelowScore=70 when not specified', async () => {
    mockAIProvider.generateReview.mockResolvedValueOnce({
      score: 69,
      summary: 'Below default skip threshold',
      verdict: 'REQUEST_CHANGES',
      strengths: [],
      issues: [
        { severity: 'major', file: 'src/app.ts', line: 11, description: 'Naming' },
      ],
      security: null,
      performance: null,
      comments: [],
      overallComment: '',
    });

    const pipeline = createReviewPipeline({
      githubClient: mockGitHubClient as any,
      aiProvider: mockAIProvider as any,
      reviewRepository: mockReviewRepository as any,
      eventBus: mockEventBus as any,
      approvalThreshold: 80,
      logger: createMockLogger(),
      clock: createMockClock(),
    });

    const event: ReviewRequestedEvent = {
      type: EVENT_TYPES.REVIEW_REQUESTED,
      payload: {
        correlationId: 'test-123',
        repository: 'owner/repo',
        prNumber: 32,
        prTitle: 'Fix issue',
        prBody: null,
        author: 'dev-user',
        baseBranch: 'main',
        headBranch: 'feat/test',
        headSha: 'abc12345',
        requestedAt: '2026-08-19T10:00:00Z',
      },
    };

    await pipeline.handleReviewRequested(event);

    const reviewInputArg = mockGitHubClient.createReview.mock.calls[0][3];
    expect(reviewInputArg.body).not.toContain('**Score:**');
    expect(reviewInputArg.event).toBe('COMMENT');
  });
});
