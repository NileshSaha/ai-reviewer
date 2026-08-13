import { BaseAIProvider, BaseAIProviderOptions } from './baseAIProvider';
import { AIReviewResult } from '../application/aiTypes';
import { Logger } from '../../../shared/types/logger';

export class OpenRouterAIProvider extends BaseAIProvider {
  protected nameValue = 'openrouter';
  protected endpoint: string;

  constructor(
    apiKey: string,
    logger: Logger,
    model = 'openrouter/free',
    endpoint = 'https://openrouter.ai/api/v1/chat/completions',
    options: BaseAIProviderOptions = {}
  ) {
    super(apiKey, logger, model);
    this.endpoint = endpoint || 'https://openrouter.ai/api/v1/chat/completions';
    this.applyOptions(options);
  }

  protected override buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'https://github.com/ai-reviewer',
      'X-Title': 'AI GitHub Reviewer',
    };
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
      max_tokens: maxResponseTokens ?? this.maxResponseTokens,
    };
  }

  parseResponse(response: any): AIReviewResult {
    if (response?.error) {
      const errMsg = typeof response.error === 'string'
        ? response.error
        : response.error.message || JSON.stringify(response.error);
      throw new Error(`OpenRouter API error: ${errMsg}`);
    }

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(
        `Empty response from OpenRouter API: ${JSON.stringify(response).slice(0, 300)}`
      );
    }
    return this.parseAIReviewResponse(content);
  }
}
