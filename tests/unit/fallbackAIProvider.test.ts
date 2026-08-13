import { FallbackAIProvider } from '../../src/modules/ai/infrastructure/fallbackAIProvider';
import { AIProvider } from '../../src/modules/ai/application/aiProvider';
import { AIReviewResult, PRDetails, DiffContent } from '../../src/modules/ai/application/aiTypes';
import { Logger } from '../../src/shared/types/logger';
import { AIProviderError } from '../../src/shared/types/errors';

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

const mockPR: PRDetails = {
  repository: 'owner/repo',
  prNumber: 10,
  title: 'Test PR',
  body: 'PR Body',
  author: 'dev',
  baseBranch: 'main',
  headBranch: 'feat',
};

const mockDiff: DiffContent = {
  files: [{ filename: 'src/app.ts', patch: '+const x = 1;', status: 'added' }],
};

const mockReviewSuccess: AIReviewResult = {
  score: 90,
  verdict: 'APPROVE',
  summary: 'Great work',
  strengths: ['Clean code'],
  issues: [],
  security: null,
  performance: null,
  comments: [],
  overallComment: 'Looks great!',
};

describe('FallbackAIProvider', () => {
  it('initializes and formats chain name properly', () => {
    const p1: AIProvider = {
      name: () => 'minimax-user1',
      validateApiKey: jest.fn().mockResolvedValue({ valid: true }),
      generateReview: jest.fn().mockResolvedValue(mockReviewSuccess),
    };
    const p2: AIProvider = {
      name: () => 'minimax-user2',
      validateApiKey: jest.fn().mockResolvedValue({ valid: true }),
      generateReview: jest.fn().mockResolvedValue(mockReviewSuccess),
    };

    const fallback = new FallbackAIProvider(
      [
        { name: 'minimax-user1', provider: p1 },
        { name: 'minimax-user2', provider: p2 },
      ],
      createMockLogger()
    );

    expect(fallback.name()).toBe('minimax-user1 (fallback: minimax-user2)');
  });

  it('uses primary provider when primary succeeds', async () => {
    const p1: AIProvider = {
      name: () => 'minimax-user1',
      validateApiKey: jest.fn().mockResolvedValue({ valid: true }),
      generateReview: jest.fn().mockResolvedValue(mockReviewSuccess),
    };
    const p2: AIProvider = {
      name: () => 'minimax-user2',
      validateApiKey: jest.fn().mockResolvedValue({ valid: true }),
      generateReview: jest.fn().mockResolvedValue(mockReviewSuccess),
    };

    const fallback = new FallbackAIProvider(
      [
        { name: 'minimax-user1', provider: p1 },
        { name: 'minimax-user2', provider: p2 },
      ],
      createMockLogger()
    );

    const result = await fallback.generateReview(mockPR, mockDiff);

    expect(result.score).toBe(90);
    expect(p1.generateReview).toHaveBeenCalledTimes(1);
    expect(p2.generateReview).not.toHaveBeenCalled();
  });

  it('fails over to secondary provider when primary throws 429 / error', async () => {
    const p1: AIProvider = {
      name: () => 'minimax-user1',
      validateApiKey: jest.fn().mockResolvedValue({ valid: false, error: 'Rate limit 429' }),
      generateReview: jest.fn().mockRejectedValue(new AIProviderError('Rate limited 429', 'minimax-user1', true)),
    };
    const p2Review: AIReviewResult = { ...mockReviewSuccess, score: 85 };
    const p2: AIProvider = {
      name: () => 'minimax-user2',
      validateApiKey: jest.fn().mockResolvedValue({ valid: true }),
      generateReview: jest.fn().mockResolvedValue(p2Review),
    };

    const fallback = new FallbackAIProvider(
      [
        { name: 'minimax-user1', provider: p1 },
        { name: 'minimax-user2', provider: p2 },
      ],
      createMockLogger()
    );

    const result = await fallback.generateReview(mockPR, mockDiff);

    expect(result.score).toBe(85);
    expect(p1.generateReview).toHaveBeenCalledTimes(1);
    expect(p2.generateReview).toHaveBeenCalledTimes(1);
  });

  it('throws AIProviderError when all providers in the chain fail', async () => {
    const p1: AIProvider = {
      name: () => 'minimax-user1',
      validateApiKey: jest.fn().mockResolvedValue({ valid: false }),
      generateReview: jest.fn().mockRejectedValue(new Error('P1 quota exceeded')),
    };
    const p2: AIProvider = {
      name: () => 'minimax-user2',
      validateApiKey: jest.fn().mockResolvedValue({ valid: false }),
      generateReview: jest.fn().mockRejectedValue(new Error('P2 quota exceeded')),
    };

    const fallback = new FallbackAIProvider(
      [
        { name: 'minimax-user1', provider: p1 },
        { name: 'minimax-user2', provider: p2 },
      ],
      createMockLogger()
    );

    await expect(fallback.generateReview(mockPR, mockDiff)).rejects.toThrow(
      /All AI providers in fallback chain failed/
    );
  });
});
