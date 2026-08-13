import { BaseAIProvider, BaseAIProviderOptions } from './baseAIProvider';
import { AIReviewResult } from '../application/aiTypes';
import { Logger } from '../../../shared/types/logger';

export class MinimaxAIProvider extends BaseAIProvider {
  protected nameValue = 'minimax';
  protected endpoint = 'https://api.minimax.chat/v1/chat/completions';

  constructor(apiKey: string, logger: Logger, model = 'MiniMax-M3', options: BaseAIProviderOptions = {}) {
    super(apiKey, logger, model);
    this.applyOptions(options);
  }

  buildRequestBody(prompt: string, maxResponseTokens?: number): object {
    return {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: {
        type: 'json_object',
      },
      max_tokens: maxResponseTokens ?? this.maxResponseTokens,
    };
  }

  parseResponse(response: any): AIReviewResult {
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Minimax API');
    }
    return this.parseAIReviewResponse(content);
  }
}