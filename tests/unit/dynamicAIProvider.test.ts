import { DynamicAIProvider } from '../../src/modules/ai/infrastructure/dynamicAIProvider';
import { ProviderPriorityRepository } from '../../src/modules/ai/application/providerPriorityRepository';
import { AIConfig } from '../../src/config/types';
import { Logger } from '../../src/shared/types/logger';

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

const mockConfig: AIConfig = {
  provider: 'minimax',
  minimaxApiKey: 'key1',
  minimaxModel: 'MiniMax-M3',
  minimaxEndpoint: 'https://api.minimax.io/v1/chat/completions',
  geminiApiKey: 'gemini-key',
  geminiModel: 'gemini-2.5-flash',
  geminiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
  openrouterApiKey: '',
  openrouterModel: 'meta-llama/llama-3.1-70b-instruct',
  openrouterEndpoint: 'https://openrouter.ai/api/v1',
  groqApiKey: 'groq-key',
  groqModel: 'llama-3.1-8b-instant',
  groqEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  openaiEndpoint: 'https://api.openai.com/v1/chat/completions',
  approvalThreshold: 80,
  skipReviewBelowScore: 70,
  maxPromptTokens: 4000,
  maxResponseTokens: 2000,
  maxPatchCharsPerFile: 8000,
};

describe('DynamicAIProvider', () => {
  let storedPriority: string[];
  let mockPriorityRepo: ProviderPriorityRepository;

  beforeEach(() => {
    storedPriority = ['minimax', 'gemini', 'groq'];
    mockPriorityRepo = {
      seedDefaultsIfEmpty: jest.fn(),
      getPriorityOrder: jest.fn().mockImplementation(async () => storedPriority),
      setPriorityOrder: jest.fn().mockImplementation(async (providers: string[]) => {
        storedPriority = providers;
        return storedPriority;
      }),
    };
  });

  it('initializes with initial priority order', () => {
    const dynamicProvider = new DynamicAIProvider(
      mockConfig,
      createMockLogger(),
      mockPriorityRepo,
      ['minimax', 'gemini']
    );

    expect(dynamicProvider.name()).toContain('minimax');
  });

  it('updates provider chain dynamically when updatePriorityOrder is called', async () => {
    const dynamicProvider = new DynamicAIProvider(
      mockConfig,
      createMockLogger(),
      mockPriorityRepo,
      ['minimax', 'gemini']
    );

    await dynamicProvider.updatePriorityOrder(['gemini', 'groq', 'minimax']);

    expect(dynamicProvider.name()).toContain('gemini');
    expect(mockPriorityRepo.setPriorityOrder).toHaveBeenCalledWith(['gemini', 'groq', 'minimax']);
  });
});
