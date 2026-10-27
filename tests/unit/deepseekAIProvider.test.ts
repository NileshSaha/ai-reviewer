import {
  DeepSeekAIProvider,
  DEEPSEEK_DEFAULT_ENDPOINT,
  DEEPSEEK_DEFAULT_MODEL,
} from '../../src/modules/ai/infrastructure/deepseekAIProvider';
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

describe('DeepSeekAIProvider', () => {
  it('should initialize with default endpoint and model', () => {
    const provider = new DeepSeekAIProvider('test-key', createMockLogger());
    expect(provider.name()).toBe('deepseek');
  });

  it('should use documented default model and endpoint', () => {
    expect(DEEPSEEK_DEFAULT_MODEL).toBe('deepseek-flash');
    expect(DEEPSEEK_DEFAULT_ENDPOINT).toBe('https://api.deepseek.com/chat/completions');
  });

  it('should allow custom model and endpoint', () => {
    const provider = new DeepSeekAIProvider(
      'test-key',
      createMockLogger(),
      'deepseek-v4-pro',
      'https://custom.deepseek.com/chat/completions'
    );
    expect(provider.name()).toBe('deepseek');
  });

  it('should build valid request body with system prompt and thinking disabled', () => {
    const provider = new DeepSeekAIProvider('test-key', createMockLogger(), 'deepseek-flash');
    const body: any = provider.buildRequestBody('Test prompt', 500);

    expect(body.model).toBe('deepseek-flash');
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.3);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('should omit temperature and floor response tokens when thinking is enabled', () => {
    const provider = new DeepSeekAIProvider(
      'test-key',
      createMockLogger(),
      'deepseek-flash',
      undefined,
      {},
      true
    );
    const body: any = provider.buildRequestBody('Test prompt', 1000);

    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(1000);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('should raise the response token floor to 8192 when thinking is enabled', () => {
    const provider = new DeepSeekAIProvider(
      'test-key',
      createMockLogger(),
      'deepseek-flash',
      undefined,
      { maxResponseTokens: 4096 },
      true
    );
    const body: any = provider.buildRequestBody('Test prompt');

    expect(body.max_tokens).toBe(8192);
  });

  it('should parse valid AI review response', () => {
    const provider = new DeepSeekAIProvider('test-key', createMockLogger());
    const result = provider.parseResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 91,
              verdict: 'APPROVE',
              summary: 'Solid change',
              strengths: ['Good tests'],
              issues: [],
            }),
          },
        },
      ],
    });

    expect(result.score).toBe(91);
    expect(result.verdict).toBe('APPROVE');
  });

  it('should ignore reasoning_content and still parse the content', () => {
    const provider = new DeepSeekAIProvider('test-key', createMockLogger(), 'deepseek-flash', undefined, {}, true);
    const result = provider.parseResponse({
      choices: [
        {
          message: {
            reasoning_content: 'Let me think about this diff...',
            content: JSON.stringify({
              score: 75,
              verdict: 'REQUEST_CHANGES',
              summary: 'Needs work',
              strengths: [],
              issues: [
                { severity: 'major', file: 'src/a.ts', line: 3, description: 'Unhandled error' },
              ],
            }),
          },
        },
      ],
    });

    expect(result.score).toBe(75);
    expect(result.issues).toHaveLength(1);
  });

  it('should throw descriptive error on API error response', () => {
    const provider = new DeepSeekAIProvider('test-key', createMockLogger());
    expect(() => {
      provider.parseResponse({
        error: {
          message: 'Insufficient Balance',
        },
      });
    }).toThrow(/DeepSeek API error: Insufficient Balance/);
  });

  it('should throw when content is empty so the fallback chain continues', () => {
    const provider = new DeepSeekAIProvider('test-key', createMockLogger());
    expect(() => {
      provider.parseResponse({
        choices: [{ message: { content: '' } }],
      });
    }).toThrow(/Empty response from DeepSeek API/);
  });
});
