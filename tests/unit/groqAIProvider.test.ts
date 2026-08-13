import { GroqAIProvider } from '../../src/modules/ai/infrastructure/groqAIProvider';
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

describe('GroqAIProvider', () => {
  it('should initialize with default endpoint and model', () => {
    const provider = new GroqAIProvider('test-key', createMockLogger());
    expect(provider.name()).toBe('groq');
  });

  it('should allow custom model and endpoint', () => {
    const provider = new GroqAIProvider(
      'test-key',
      createMockLogger(),
      'custom-llama',
      'https://custom.groq.com/v1/chat/completions'
    );
    expect(provider.name()).toBe('groq');
  });

  it('should build valid request body with system prompt', () => {
    const provider = new GroqAIProvider('test-key', createMockLogger(), 'llama-3.1-8b-instant');
    const body: any = provider.buildRequestBody('Test prompt', 500);

    expect(body.model).toBe('llama-3.1-8b-instant');
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.3);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('should parse valid AI review response', () => {
    const provider = new GroqAIProvider('test-key', createMockLogger());
    const result = provider.parseResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 95,
              verdict: 'APPROVE',
              summary: 'Excellent changes',
              strengths: ['Well tested'],
              issues: [],
            }),
          },
        },
      ],
    });

    expect(result.score).toBe(95);
    expect(result.verdict).toBe('APPROVE');
  });

  it('should throw descriptive error on API error response', () => {
    const provider = new GroqAIProvider('test-key', createMockLogger());
    expect(() => {
      provider.parseResponse({
        error: {
          message: 'Rate limit reached',
        },
      });
    }).toThrow(/Groq API error: Rate limit reached/);
  });
});
