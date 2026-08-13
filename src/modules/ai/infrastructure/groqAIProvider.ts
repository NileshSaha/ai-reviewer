import { BaseAIProvider, AIResponse, BaseAIProviderOptions } from './baseAIProvider';
import { Logger } from '../../../shared/types/logger';

export class GroqAIProvider extends BaseAIProvider {
  protected nameValue = 'groq';
  protected endpoint = 'https://api.groq.com/openai/v1/chat/completions';

  constructor(apiKey: string, logger: Logger, model = 'llama-3.1-8b-instant', options: BaseAIProviderOptions = {}) {
    super(apiKey, logger, model);
    this.applyOptions(options);
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

  parseResponse(response: any): AIResponse {
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Groq API');
    }
    return this.parseAIReviewResponse(content);
  }
}