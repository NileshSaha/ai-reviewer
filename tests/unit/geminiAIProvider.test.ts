import { GeminiAIProvider } from '../../src/modules/ai/infrastructure/geminiAIProvider';
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

describe('GeminiAIProvider', () => {
  it('should initialize with default endpoint and model', () => {
    const provider = new GeminiAIProvider('test-key', createMockLogger());
    expect(provider.name()).toBe('gemini');
  });

  it('should allow custom model and endpoint', () => {
    const provider = new GeminiAIProvider(
      'test-key',
      createMockLogger(),
      'gemini-1.5-pro',
      'https://custom.gemini.endpoint/v1'
    );
    expect(provider.name()).toBe('gemini');
  });

  it('should build valid request body with system prompt', () => {
    const provider = new GeminiAIProvider('test-key', createMockLogger(), 'gemini-2.5-flash');
    const body: any = provider.buildRequestBody('Test prompt', 500);

    expect(body.model).toBe('gemini-2.5-flash');
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.2);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('should parse valid AI review response', () => {
    const provider = new GeminiAIProvider('test-key', createMockLogger());
    const result = provider.parseResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 92,
              verdict: 'APPROVE',
              summary: 'Solid PR',
              strengths: ['Great tests'],
              issues: [],
            }),
          },
        },
      ],
    });

    expect(result.score).toBe(92);
    expect(result.verdict).toBe('APPROVE');
  });

  it('should throw descriptive error on API error response', () => {
    const provider = new GeminiAIProvider('test-key', createMockLogger());
    expect(() => {
      provider.parseResponse({
        error: {
          message: 'API quota exceeded',
        },
      });
    }).toThrow(/Gemini API error: API quota exceeded/);
  });
});
