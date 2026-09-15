import { AIProvider, ReviewOptions } from '../application/aiProvider';
import { AIReviewResult, PRDetails, DiffContent } from '../application/aiTypes';
import { Logger } from '../../../shared/types/logger';
import { AIProviderError } from '../../../shared/types/errors';

export interface ProviderEntry {
  name: string;
  provider: AIProvider;
}

export class FallbackAIProvider implements AIProvider {
  private entries: ProviderEntry[];
  private logger: Logger;

  constructor(entries: ProviderEntry[], logger: Logger) {
    if (!entries.length) {
      throw new Error('FallbackAIProvider requires at least one provider entry');
    }
    this.entries = entries;
    this.logger = logger;
  }

  name(): string {
    if (this.entries.length === 1) {
      return this.entries[0].name;
    }
    const primary = this.entries[0].name;
    const fallbacks = this.entries.slice(1).map((e) => e.name).join(', ');
    return `${primary} (fallback: ${fallbacks})`;
  }

  getEntries(): ProviderEntry[] {
    return [...this.entries];
  }

  async validateApiKey(): Promise<{ valid: boolean; error?: string }> {
    const primary = this.entries[0];
    const primaryResult = await primary.provider.validateApiKey();
    if (primaryResult.valid) {
      return { valid: true };
    }

    this.logger.warn(`Primary provider '${primary.name}' key validation failed: ${primaryResult.error}. Checking fallbacks...`);

    // Check if any fallback provider has a valid key
    for (let i = 1; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const result = await entry.provider.validateApiKey();
      if (result.valid) {
        return {
          valid: true,
          error: `Primary provider '${primary.name}' failed (${primaryResult.error}), but fallback '${entry.name}' is healthy`,
        };
      }
    }

    return {
      valid: false,
      error: `All configured AI providers failed authentication. Primary error: ${primaryResult.error}`,
    };
  }

  async generateReview(
    pr: PRDetails,
    diff: DiffContent,
    options?: ReviewOptions
  ): Promise<AIReviewResult> {
    const errors: Array<{ provider: string; error: string }> = [];

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const isFallback = i > 0;

      if (isFallback) {
        this.logger.info(`Attempting review generation with fallback provider '${entry.name}'`, {
          pr_number: pr.prNumber,
          repository: pr.repository,
          provider: entry.name,
          fallback_index: i,
        });
      }

      try {
        const result = await entry.provider.generateReview(pr, diff, options);
        if (isFallback) {
          this.logger.info(`Successfully generated review using fallback provider '${entry.name}'`, {
            pr_number: pr.prNumber,
            repository: pr.repository,
            provider: entry.name,
          });
        }
        return {
          ...result,
          provider: entry.name,
        };
      } catch (err: any) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push({ provider: entry.name, error: errorMsg });

        this.logger.warn(`AI Provider '${entry.name}' failed during review generation`, {
          pr_number: pr.prNumber,
          repository: pr.repository,
          provider: entry.name,
          error: errorMsg,
          has_more_fallbacks: i < this.entries.length - 1,
        });
      }
    }

    const summary = errors.map((e) => `[${e.provider}]: ${e.error}`).join(' | ');
    throw new AIProviderError(
      `All AI providers in fallback chain failed for PR #${pr.prNumber}: ${summary}`,
      this.name(),
      false
    );
  }
}
