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
  provider: 'minimax' | 'gemini' | 'openrouter' | 'groq' | 'openai';
  minimaxApiKey: string;
  minimaxApiKey2?: string;
  minimaxModel: string;
  minimaxEndpoint?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  geminiEndpoint?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  openrouterEndpoint?: string;
  groqApiKey: string;
  groqModel: string;
  groqEndpoint?: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiEndpoint?: string;
  approvalThreshold: number;
  skipReviewBelowScore: number;
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