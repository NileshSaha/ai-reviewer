import { ProviderPriorityRepository } from '../application/providerPriorityRepository';
import { ProviderPriorityModel } from '../../../database/models/providerPriority';
import { Logger } from '../../../shared/types/logger';

export class SequelizeProviderPriorityRepository implements ProviderPriorityRepository {
  constructor(private logger: Logger) {}

  async seedDefaultsIfEmpty(defaultProviders: string[]): Promise<void> {
    const existingCount = await ProviderPriorityModel.count();
    if (existingCount > 0) {
      this.logger.info('Provider priority records already exist in database, skipping default seeding', {
        existingCount,
      });
      return;
    }

    this.logger.info(`Seeding initial provider priority order (${defaultProviders.length} providers)`, {
      providers: defaultProviders,
    });

    for (let i = 0; i < defaultProviders.length; i++) {
      const provider = defaultProviders[i];
      await ProviderPriorityModel.create({
        provider,
        priority: i + 1,
      });
    }

    this.logger.info('Initial provider priority order seeded successfully');
  }

  async getPriorityOrder(): Promise<string[]> {
    const records = await ProviderPriorityModel.findAll({
      order: [['priority', 'ASC']],
    });

    return records.map((r) => r.provider);
  }

  async setPriorityOrder(providers: string[]): Promise<string[]> {
    if (!providers || providers.length === 0) {
      throw new Error('Provider list cannot be empty');
    }

    // Sanitize and deduplicate while keeping input order
    const sanitizedProviders: string[] = [];
    for (const p of providers) {
      const trimmed = p.trim();
      if (trimmed && !sanitizedProviders.includes(trimmed)) {
        sanitizedProviders.push(trimmed);
      }
    }

    // Get all existing records from DB to ensure any missing providers are appended at the end
    const existingRecords = await ProviderPriorityModel.findAll();
    const existingMap = new Map<string, ProviderPriorityModel>();
    for (const rec of existingRecords) {
      existingMap.set(rec.provider, rec);
    }

    // Priority for explicitly passed providers
    let currentPriority = 1;
    for (const provider of sanitizedProviders) {
      const existing = existingMap.get(provider);
      if (existing) {
        await existing.update({ priority: currentPriority });
        existingMap.delete(provider);
      } else {
        await ProviderPriorityModel.create({
          provider,
          priority: currentPriority,
        });
      }
      currentPriority++;
    }

    // Append remaining existing providers retaining relative rank
    const remaining = Array.from(existingMap.values()).sort((a, b) => a.priority - b.priority);
    for (const rec of remaining) {
      await rec.update({ priority: currentPriority });
      currentPriority++;
    }

    const updatedRecords = await ProviderPriorityModel.findAll({
      order: [['priority', 'ASC']],
    });

    const finalOrder = updatedRecords.map((r) => r.provider);
    this.logger.info('Updated provider priority order', { priorityOrder: finalOrder });
    return finalOrder;
  }
}
