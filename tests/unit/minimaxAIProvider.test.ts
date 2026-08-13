import { MinimaxAIProvider } from '../../src/modules/ai/infrastructure/minimaxAIProvider';
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

describe('MinimaxAIProvider', () => {
  it('should initialize with default endpoint and model', () => {
    const provider = new MinimaxAIProvider('test-key', createMockLogger());
    expect(provider.name()).toBe('minimax');
  });

  it('should allow custom model and endpoint', () => {
    const provider = new MinimaxAIProvider(
      'test-key',
      createMockLogger(),
      'MiniMax-Text-01',
      'https://api.minimaxi.chat/v1/chat/completions'
    );
    expect(provider.name()).toBe('minimax');
  });

  it('should build valid request body with system prompt', () => {
    const provider = new MinimaxAIProvider('test-key', createMockLogger(), 'MiniMax-M3');
    const body: any = provider.buildRequestBody('Test prompt', 500);

    expect(body.model).toBe('MiniMax-M3');
    expect(body.max_tokens).toBe(500);
    expect(body.temperature).toBe(0.3);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('should parse valid AI review response', () => {
    const provider = new MinimaxAIProvider('test-key', createMockLogger());
    const result = provider.parseResponse({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 90,
              verdict: 'APPROVE',
              summary: 'Looks great!',
              strengths: ['Clean code'],
              issues: [],
            }),
          },
        },
      ],
    });

    expect(result.score).toBe(90);
    expect(result.verdict).toBe('APPROVE');
    expect(result.summary).toBe('Looks great!');
  });

  it('should throw descriptive error on MiniMax business error (base_resp)', () => {
    const provider = new MinimaxAIProvider('test-key', createMockLogger());
    expect(() => {
      provider.parseResponse({
        base_resp: {
          status_code: 1004,
          status_msg: 'invalid api key',
        },
      });
    }).toThrow(/MiniMax API business error \(1004\): invalid api key/);
  });

  it('should throw descriptive error on MiniMax error object', () => {
    const provider = new MinimaxAIProvider('test-key', createMockLogger());
    expect(() => {
      provider.parseResponse({
        error: {
          message: 'Model not found',
        },
      });
    }).toThrow(/MiniMax API error: Model not found/);
  });
});
