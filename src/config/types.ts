export interface DatabaseConfig {
  url: string;
}

export interface GitHubConfig {
  pat: string;
  username: string;
}

export interface SchedulerConfig {
  pollIntervalSeconds: number;
  repositories: RepositoryConfig[];
  concurrencyLimit: number;
  staggerDelaySeconds: number;
  cooldownMinutes: number;
}

export interface RepositoryConfig {
  owner: string;
  repo: string;
}

export interface AIConfig {
  provider: 'minimax' | 'groq' | 'openai';
  minimaxApiKey: string;
  minimaxModel: string;
  groqApiKey: string;
  groqModel: string;
  openaiApiKey: string;
  openaiModel: string;
  approvalThreshold: number;
  maxPromptTokens: number;
  maxResponseTokens: number;
  maxPatchCharsPerFile: number;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  database: DatabaseConfig;
  github: GitHubConfig;
  scheduler: SchedulerConfig;
  ai: AIConfig;
}