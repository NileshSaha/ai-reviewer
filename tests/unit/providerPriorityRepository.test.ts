import { SequelizeProviderPriorityRepository } from '../../src/modules/ai/infrastructure/sequelizeProviderPriorityRepository';
import { ProviderPriorityModel } from '../../src/database/models/providerPriority';
import { Logger } from '../../src/shared/types/logger';

function createMockLogger(): Logger {
  const noop = (..._: any[]) => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    withContext: () => createMockLogger(),
  };
}

describe('SequelizeProviderPriorityRepository', () => {
  let repository: SequelizeProviderPriorityRepository;
  let mockRecords: Array<{ provider: string; priority: number; update: jest.Mock }>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecords = [];

    jest.spyOn(ProviderPriorityModel, 'count').mockImplementation(async () => mockRecords.length);

    jest.spyOn(ProviderPriorityModel, 'findAll').mockImplementation(async (opts?: any) => {
      const copy = [...mockRecords];
      if (opts?.order && Array.isArray(opts.order)) {
        copy.sort((a, b) => a.priority - b.priority);
      }
      return copy as any;
    });

    jest.spyOn(ProviderPriorityModel, 'create').mockImplementation(async (data: any) => {
      const rec = {
        provider: data.provider,
        priority: data.priority,
        update: jest.fn().mockImplementation(async (updData: any) => {
          if (updData.priority !== undefined) rec.priority = updData.priority;
          return rec;
        }),
      };
      mockRecords.push(rec);
      return rec as any;
    });

    repository = new SequelizeProviderPriorityRepository(createMockLogger());
  });

  it('seeds default provider priorities when table is empty', async () => {
    const defaults = ['minimax', 'gemini', 'openrouter', 'groq', 'openai'];
    await repository.seedDefaultsIfEmpty(defaults);

    const order = await repository.getPriorityOrder();
    expect(order).toEqual(defaults);
    expect(ProviderPriorityModel.create).toHaveBeenCalledTimes(5);
  });

  it('does NOT overwrite or re-seed if records are already inserted', async () => {
    mockRecords.push(
      { provider: 'gemini', priority: 1, update: jest.fn() },
      { provider: 'groq', priority: 2, update: jest.fn() }
    );

    const defaults = ['minimax', 'gemini', 'openrouter', 'groq', 'openai'];
    await repository.seedDefaultsIfEmpty(defaults);

    const order = await repository.getPriorityOrder();
    expect(order).toEqual(['gemini', 'groq']);
    expect(ProviderPriorityModel.create).not.toHaveBeenCalled();
  });

  it('updates provider priorities correctly via setPriorityOrder', async () => {
    const defaults = ['minimax', 'gemini', 'openrouter', 'groq', 'openai'];
    await repository.seedDefaultsIfEmpty(defaults);

    const newOrder = ['gemini', 'groq', 'minimax'];
    const result = await repository.setPriorityOrder(newOrder);

    expect(result.slice(0, 3)).toEqual(['gemini', 'groq', 'minimax']);
  });
});
