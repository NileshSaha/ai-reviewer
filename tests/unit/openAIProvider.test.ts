import { OpenAIProvider } from '../../src/modules/ai/infrastructure/openAIProvider';
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

describe('OpenAIProvider', () => {
  it('should initialize with default endpoint and model', () => {
    const provider = new OpenAIProvider('test-key', createMockLogger());
    expect(provider.name()).toBe('openai');
  });

  it('should allow custom model and endpoint', () => {
    const provider = new OpenAIProvider(
      'test-key',
      createMockLogger(),
      'gpt-4o',
      'https://custom.openai.com/v1/chat/completions'
    );
    expect(provider.name()).toBe('openai');
  });

  it('should build valid request body with system prompt', () => {
    const provider = new OpenAIProvider('test-key', createMockLogger(), 'gpt-4o-mini');
    const body: any = provider.buildRequestBody('Test prompt', 500);

    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.3);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('should parse valid AI review response', () => {
    const provider = new OpenAIProvider('test-key', createMockLogger());
    const result = provider.parseResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 88,
              verdict: 'APPROVE',
              summary: 'Good PR',
              strengths: ['Clear structure'],
              issues: [],
            }),
          },
        },
      ],
    });

    expect(result.score).toBe(88);
    expect(result.verdict).toBe('APPROVE');
  });

  it('should throw descriptive error on API error response', () => {
    const provider = new OpenAIProvider('test-key', createMockLogger());
    expect(() => {
      provider.parseResponse({
        error: {
          message: 'Invalid model',
        },
      });
    }).toThrow(/OpenAI API error: Invalid model/);
  });
});
