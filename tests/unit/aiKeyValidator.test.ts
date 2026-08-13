import { BaseAIProvider, BaseAIProviderOptions } from '../../src/modules/ai/infrastructure/baseAIProvider';
import { AIReviewResult } from '../../src/modules/ai/application/aiTypes';
import { Logger } from '../../src/shared/types/logger';

class FakeProvider extends BaseAIProvider {
  protected nameValue = 'fake';
  protected endpoint = 'https://fake.example/v1/chat/completions';

  constructor(apiKey: string, logger: Logger, options: BaseAIProviderOptions = {}) {
    super(apiKey, logger, 'fake-model');
    this.applyOptions(options);
  }

  buildRequestBody(prompt: string, maxResponseTokens?: number): object {
    return {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxResponseTokens ?? this.maxResponseTokens,
    };
  }

  parseResponse(response: any): AIReviewResult {
    return this.parseAIReviewResponse(response.content);
  }
}

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

function mockFetchResponse(status: number, body = ''): jest.Mock {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => ({}),
  }));
}

describe('BaseAIProvider.validateApiKey', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns valid when the endpoint returns 200', async () => {
    globalThis.fetch = mockFetchResponse(200, '{"choices":[]}') as unknown as typeof globalThis.fetch;
    const provider = new FakeProvider('test-key', createMockLogger());

    const result = await provider.validateApiKey();

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends a POST with bearer auth and a tiny body', async () => {
    globalThis.fetch = mockFetchResponse(200) as unknown as typeof globalThis.fetch;
    const provider = new FakeProvider('my-secret', createMockLogger());

    await provider.validateApiKey();

    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://fake.example/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer my-secret');
    const parsed = JSON.parse(init.body);
    expect(parsed.model).toBe('fake-model');
    expect(parsed.max_tokens).toBeLessThanOrEqual(16);
    expect(parsed.messages).toEqual([
      { role: 'user', content: 'Respond with valid JSON only: {"ok": true}' },
    ]);
  });

  it('returns invalid with Auth failed message on 401', async () => {
    globalThis.fetch = mockFetchResponse(401, 'unauthorized') as unknown as typeof globalThis.fetch;
    const provider = new FakeProvider('bad-key', createMockLogger());

    const result = await provider.validateApiKey();

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Auth failed (401)');
    expect(result.error).toContain('unauthorized');
  });

  it('returns invalid with Auth failed message on 403', async () => {
    globalThis.fetch = mockFetchResponse(403, 'forbidden') as unknown as typeof globalThis.fetch;
    const provider = new FakeProvider('bad-key', createMockLogger());

    const result = await provider.validateApiKey();

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Auth failed (403)');
  });

  it('returns invalid with rate-limited message on 429', async () => {
    globalThis.fetch = mockFetchResponse(429) as unknown as typeof globalThis.fetch;
    const provider = new FakeProvider('key', createMockLogger());

    const result = await provider.validateApiKey();

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Rate limited (429)');
  });

  it('returns invalid with HTTP code on other non-2xx responses', async () => {
    globalThis.fetch = mockFetchResponse(500, 'boom') as unknown as typeof globalThis.fetch;
    const provider = new FakeProvider('key', createMockLogger());

    const result = await provider.validateApiKey();

    expect(result.valid).toBe(false);
    expect(result.error).toContain('HTTP 500');
    expect(result.error).toContain('boom');
  });

  it('returns invalid with network error message when fetch throws', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    const provider = new FakeProvider('key', createMockLogger());

    const result = await provider.validateApiKey();

    expect(result.valid).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('does not throw even if fetch rejects with a non-Error value', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw 'string error';
    }) as unknown as typeof globalThis.fetch;
    const provider = new FakeProvider('key', createMockLogger());

    const result = await provider.validateApiKey();

    expect(result.valid).toBe(false);
    expect(result.error).toBe('string error');
  });
});
