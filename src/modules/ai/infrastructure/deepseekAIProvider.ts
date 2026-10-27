import { BaseAIProvider, BaseAIProviderOptions } from './baseAIProvider';
import { AIReviewResult } from '../application/aiTypes';
import { Logger } from '../../../shared/types/logger';

export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash';
export const DEEPSEEK_DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export class DeepSeekAIProvider extends BaseAIProvider {
  protected nameValue = 'deepseek';
  protected endpoint: string;
  private thinking: boolean;

  constructor(
    apiKey: string,
    logger: Logger,
    model = DEEPSEEK_DEFAULT_MODEL,
    endpoint = DEEPSEEK_DEFAULT_ENDPOINT,
    options: BaseAIProviderOptions = {},
    thinking = false
  ) {
    super(apiKey, logger, model);
    this.endpoint = endpoint || DEEPSEEK_DEFAULT_ENDPOINT;
    this.thinking = thinking;
    this.applyOptions(options);
  }

  protected override applyOptions(opts: BaseAIProviderOptions): void {
    super.applyOptions(opts);
    // Thinking mode spends output tokens on chain-of-thought before the final
    // JSON answer, so keep enough headroom for the payload to survive.
    if (this.thinking && this.maxResponseTokens < 8192) {
      this.maxResponseTokens = 8192;
    }
  }

  buildRequestBody(prompt: string, maxResponseTokens?: number): object {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert code reviewer. You MUST respond with valid JSON only, matching the JSON schema provided in the user message.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      // DeepSeek JSON Output requires response_format json_object plus the word
      // "json" and a schema example in the prompt (handled by promptBuilder).
      response_format: { type: 'json_object' },
      thinking: { type: this.thinking ? 'enabled' : 'disabled' },
      max_tokens: maxResponseTokens ?? this.maxResponseTokens,
    };

    // Thinking mode ignores temperature, so only send it when thinking is off.
    if (!this.thinking) {
      body.temperature = 0.3;
    }

    return body;
  }

  parseResponse(response: any): AIReviewResult {
    if (response?.error) {
      const errMsg = typeof response.error === 'string'
        ? response.error
        : response.error.message || JSON.stringify(response.error);
      throw new Error(`DeepSeek API error: ${errMsg}`);
    }

    const message = response.choices?.[0]?.message;
    const content = message?.content;
    if (!content) {
      // DeepSeek documents occasional empty content in JSON output mode.
      // Fail fast so the fallback chain can try the next provider.
      throw new Error(
        `Empty response from DeepSeek API: ${JSON.stringify(response).slice(0, 300)}`
      );
    }

    if (message?.reasoning_content) {
      this.logger.debug('DeepSeek returned separate reasoning stream', {
        reasoning_length: (message.reasoning_content || '').length,
      });
    }

    return this.parseAIReviewResponse(content);
  }
}
