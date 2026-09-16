import { BaseAIProvider, BaseAIProviderOptions } from './baseAIProvider';
import { AIReviewResult } from '../application/aiTypes';
import { Logger } from '../../../shared/types/logger';

export class GeminiAIProvider extends BaseAIProvider {
  protected nameValue = 'gemini';
  protected endpoint: string;

  constructor(
    apiKey: string,
    logger: Logger,
    model = 'gemini-3.5-flash',
    endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    options: BaseAIProviderOptions = {}
  ) {
    super(apiKey, logger, model);
    this.endpoint = endpoint || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    this.applyOptions(options);
  }

  buildRequestBody(prompt: string, maxResponseTokens?: number): object {
    return {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert code reviewer. You MUST respond with complete, valid JSON matching the requested structure. Keep summaries concise so all issues and suggestions fit within output limits.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: maxResponseTokens ?? this.maxResponseTokens,
    };
  }

  parseResponse(response: any): AIReviewResult {
    if (response?.error) {
      const errMsg = typeof response.error === 'string'
        ? response.error
        : response.error.message || JSON.stringify(response.error);
      throw new Error(`Gemini API error: ${errMsg}`);
    }

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(
        `Empty response from Gemini API: ${JSON.stringify(response).slice(0, 300)}`
      );
    }
    return this.parseAIReviewResponse(content);
  }
}
