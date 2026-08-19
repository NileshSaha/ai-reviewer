import { BaseAIProvider, BaseAIProviderOptions } from './baseAIProvider';
import { AIReviewResult } from '../application/aiTypes';
import { Logger } from '../../../shared/types/logger';

export class MinimaxAIProvider extends BaseAIProvider {
  protected nameValue = 'minimax';
  protected endpoint: string;

  constructor(
    apiKey: string,
    logger: Logger,
    model = 'MiniMax-M3',
    endpoint = 'https://api.minimax.io/v1/chat/completions',
    options: BaseAIProviderOptions = {}
  ) {
    super(apiKey, logger, model);
    this.endpoint = endpoint || 'https://api.minimax.io/v1/chat/completions';
    this.applyOptions(options);
  }

  protected override applyOptions(opts: BaseAIProviderOptions): void {
    super.applyOptions(opts);
    if (!opts.maxResponseTokens || this.maxResponseTokens < 4096) {
      this.maxResponseTokens = Math.max(this.maxResponseTokens, 4096);
    }
  }

  buildRequestBody(prompt: string, maxResponseTokens?: number): object {
    return {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert code reviewer. You MUST respond with valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      reasoning_split: true,
      max_tokens: maxResponseTokens ?? this.maxResponseTokens,
    };
  }

  parseResponse(response: any): AIReviewResult {
    if (response?.base_resp && response.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMax API business error (${response.base_resp.status_code}): ${response.base_resp.status_msg || 'Unknown error'}`
      );
    }

    if (response?.error) {
      const errMsg = typeof response.error === 'string'
        ? response.error
        : response.error.message || JSON.stringify(response.error);
      throw new Error(`MiniMax API error: ${errMsg}`);
    }

    const message = response.choices?.[0]?.message;
    const content = message?.content;
    if (!content) {
      throw new Error(
        `Empty response from Minimax API: ${JSON.stringify(response).slice(0, 300)}`
      );
    }

    if (message?.reasoning_details || message?.reasoning_content) {
      this.logger.debug('MiniMax returned separate reasoning stream', {
        reasoning_length: (message.reasoning_details || message.reasoning_content || '').length,
      });
    }

    return this.parseAIReviewResponse(content);
  }
}