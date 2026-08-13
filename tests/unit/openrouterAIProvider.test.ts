import { OpenRouterAIProvider } from '../../src/modules/ai/infrastructure/openrouterAIProvider';
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

describe('OpenRouterAIProvider', () => {
  it('should initialize with default endpoint and model', () => {
    const provider = new OpenRouterAIProvider('test-key', createMockLogger());
    expect(provider.name()).toBe('openrouter');
  });

  it('should allow custom model and endpoint', () => {
    const provider = new OpenRouterAIProvider(
      'test-key',
      createMockLogger(),
      'anthropic/claude-3.5-sonnet',
      'https://custom.openrouter.ai/v1'
    );
    expect(provider.name()).toBe('openrouter');
  });

  it('should build valid request body with system prompt', () => {
    const provider = new OpenRouterAIProvider('test-key', createMockLogger(), 'meta-llama/llama-3.1-8b-instruct');
    const body: any = provider.buildRequestBody('Test prompt', 500);

    expect(body.model).toBe('meta-llama/llama-3.1-8b-instruct');
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.3);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('should parse valid AI review response', () => {
    const provider = new OpenRouterAIProvider('test-key', createMockLogger());
    const result = provider.parseResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 87,
              verdict: 'APPROVE',
              summary: 'Looks good',
              strengths: ['Types are strict'],
              issues: [],
            }),
          },
        },
      ],
    });

    expect(result.score).toBe(87);
    expect(result.verdict).toBe('APPROVE');
  });

  it('should throw descriptive error on API error response', () => {
    const provider = new OpenRouterAIProvider('test-key', createMockLogger());
    expect(() => {
      provider.parseResponse({
        error: {
          message: 'Insufficient balance',
        },
      });
    }).toThrow(/OpenRouter API error: Insufficient balance/);
  });
});
