import { AIProvider, ReviewOptions } from '../application/aiProvider';
import { AIReviewResult, PRDetails, DiffContent } from '../application/aiTypes';
import { AIConfig } from '../../../config/types';
import { Logger } from '../../../shared/types/logger';
import { createAIProvider } from './aiFactory';
import { ProviderPriorityRepository } from '../application/providerPriorityRepository';

export class DynamicAIProvider implements AIProvider {
  private currentProvider: AIProvider;

  constructor(
    private config: AIConfig,
    private logger: Logger,
    private priorityRepo: ProviderPriorityRepository,
    initialPriorityOrder?: string[]
  ) {
    this.currentProvider = createAIProvider(config, logger, initialPriorityOrder);
  }

  name(): string {
    return this.currentProvider.name();
  }

  async validateApiKey(): Promise<{ valid: boolean; error?: string }> {
    return this.currentProvider.validateApiKey();
  }

  async generateReview(
    pr: PRDetails,
    diff: DiffContent,
    options?: ReviewOptions
  ): Promise<AIReviewResult> {
    return this.currentProvider.generateReview(pr, diff, options);
  }

  async updatePriorityOrder(newOrder: string[]): Promise<string[]> {
    const updatedOrder = await this.priorityRepo.setPriorityOrder(newOrder);
    this.currentProvider = createAIProvider(this.config, this.logger, updatedOrder);
    this.logger.info(`DynamicAIProvider re-initialized chain: ${this.name()}`);
    return updatedOrder;
  }

  async getPriorityOrder(): Promise<string[]> {
    return this.priorityRepo.getPriorityOrder();
  }
}
