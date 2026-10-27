export interface ProviderPriorityRecord {
  provider: string;
  priority: number;
}

export interface ProviderPriorityRepository {
  seedDefaultsIfEmpty(defaultProviders: string[]): Promise<void>;
  ensureProvidersExist(providers: string[]): Promise<void>;
  getPriorityOrder(): Promise<string[]>;
  setPriorityOrder(providers: string[]): Promise<string[]>;
}
