import { AIReviewResult, PRDetails, DiffContent } from './aiTypes';

export interface TokenBudget {
  maxPromptTokens: number;
  maxResponseTokens: number;
  charsPerToken: number;
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  maxPromptTokens: 4500,
  maxResponseTokens: 4096,
  charsPerToken: 4,
};

export interface ReviewOptions {
  tokenBudget?: TokenBudget;
  retryOnRateLimit?: boolean;
  shrinkFactor?: number;
}

export interface AIProvider {
  generateReview(
    pr: PRDetails,
    diff: DiffContent,
    options?: ReviewOptions
  ): Promise<AIReviewResult>;
  name(): string;
  validateApiKey(): Promise<{ valid: boolean; error?: string }>;
}

export { AIReviewResult, PRDetails, DiffContent };
export const AI_PROVIDER_TOKEN = Symbol('AIProvider');