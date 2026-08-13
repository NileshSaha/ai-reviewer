import dotenv from 'dotenv';
import path from 'path';
import { AppConfig, GitHubConfig, SchedulerConfig, AIConfig, DatabaseConfig, RepositoryConfig } from './types';
import { ValidationError } from '../shared/types/errors';

export * from './types';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function getEnv(varName: string): string {
  const value = process.env[varName];
  if (!value) {
    throw new ValidationError(`Missing required environment variable: ${varName}`);
  }
  return value;
}

function getEnvOptional(varName: string, defaultValue: string): string {
  return process.env[varName] ?? defaultValue;
}

function getEnvInt(varName: string, defaultValue: number): number {
  const value = process.env[varName];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new ValidationError(`${varName} must be a valid integer`);
  }
  return parsed;
}

function parseRepositories(): RepositoryConfig[] {
  const reposStr = process.env['REPOSITORIES'] ?? '';
  if (!reposStr.trim()) {
    return [];
  }

  return reposStr
    .split(',')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const parts = line.split('/');
      if (parts.length !== 2) {
        throw new ValidationError(`Invalid repository format: ${line}. Expected: owner/repo`);
      }
      return { owner: parts[0], repo: parts[1] };
    });
}

export function loadConfig(): AppConfig {
  const llmProvider = getEnvOptional('LLM_PROVIDER', 'minimax') as AIConfig['provider'];
  if (!['minimax', 'gemini', 'openrouter', 'groq', 'openai'].includes(llmProvider)) {
    throw new ValidationError(`Invalid LLM_PROVIDER: ${llmProvider}`);
  }

  const pollInterval = getEnvInt('POLL_INTERVAL', 60);
  if (pollInterval < 1 || pollInterval > 3600) {
    throw new ValidationError('POLL_INTERVAL must be between 1 and 3600 seconds');
  }

  const concurrencyLimit = getEnvInt('CONCURRENCY_LIMIT', 2);
  if (concurrencyLimit < 1 || concurrencyLimit > 10) {
    throw new ValidationError('CONCURRENCY_LIMIT must be between 1 and 10');
  }

  const staggerDelaySeconds = getEnvInt('STAGGER_DELAY_SECONDS', 10);
  if (staggerDelaySeconds < 0 || staggerDelaySeconds > 300) {
    throw new ValidationError('STAGGER_DELAY_SECONDS must be between 0 and 300');
  }

  const cooldownMinutes = getEnvInt('COOLDOWN_MINUTES', 10);
  if (cooldownMinutes < 0 || cooldownMinutes > 1440) {
    throw new ValidationError('COOLDOWN_MINUTES must be between 0 and 1440');
  }

  const maxPromptTokens = getEnvInt('MAX_PROMPT_TOKENS', 4500);
  if (maxPromptTokens < 500 || maxPromptTokens > 32000) {
    throw new ValidationError('MAX_PROMPT_TOKENS must be between 500 and 32000');
  }

  const maxResponseTokens = getEnvInt('MAX_RESPONSE_TOKENS', 1000);
  if (maxResponseTokens < 100 || maxResponseTokens > 4000) {
    throw new ValidationError('MAX_RESPONSE_TOKENS must be between 100 and 4000');
  }

  const maxPatchCharsPerFile = getEnvInt('MAX_PATCH_CHARS_PER_FILE', 1500);
  if (maxPatchCharsPerFile < 200 || maxPatchCharsPerFile > 20000) {
    throw new ValidationError('MAX_PATCH_CHARS_PER_FILE must be between 200 and 20000');
  }

  const repositories = parseRepositories();

  const database: DatabaseConfig = {
    url: getEnv('DATABASE_URL'),
  };

  const github: GitHubConfig = {
    pat: getEnv('GITHUB_PAT'),
    username: getEnv('GITHUB_USERNAME'),
  };

  const scheduler: SchedulerConfig = {
    pollIntervalSeconds: pollInterval,
    repositories,
    concurrencyLimit,
    staggerDelaySeconds,
    cooldownMinutes,
  };

  const ai: AIConfig = {
    provider: llmProvider,
    minimaxApiKey: process.env['MINIMAX_API_KEY'] ?? '',
    minimaxApiKey2: process.env['MINIMAX_API_KEY_2'] || undefined,
    minimaxModel: getEnvOptional('MINIMAX_MODEL', 'MiniMax-M3'),
    minimaxEndpoint: getEnvOptional('MINIMAX_API_ENDPOINT', 'https://api.minimax.io/v1/chat/completions'),
    geminiApiKey: process.env['GEMINI_API_KEY'] || undefined,
    geminiModel: getEnvOptional('GEMINI_MODEL', 'gemini-3.5-flash'),
    geminiEndpoint: getEnvOptional('GEMINI_API_ENDPOINT', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'),
    openrouterApiKey: process.env['OPENROUTER_API_KEY'] || undefined,
    openrouterModel: getEnvOptional('OPENROUTER_MODEL', 'openrouter/free'),
    openrouterEndpoint: getEnvOptional('OPENROUTER_API_ENDPOINT', 'https://openrouter.ai/api/v1/chat/completions'),
    groqApiKey: process.env['GROQ_API_KEY'] ?? '',
    groqModel: getEnvOptional('GROQ_MODEL', 'llama-3.1-8b-instant'),
    groqEndpoint: getEnvOptional('GROQ_API_ENDPOINT', 'https://api.groq.com/openai/v1/chat/completions'),
    openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
    openaiModel: getEnvOptional('OPENAI_MODEL', 'gpt-4o-mini'),
    openaiEndpoint: getEnvOptional('OPENAI_API_ENDPOINT', 'https://api.openai.com/v1/chat/completions'),
    approvalThreshold: getEnvInt('APPROVAL_THRESHOLD', 80),
    maxPromptTokens,
    maxResponseTokens,
    maxPatchCharsPerFile,
  };

  return {
    port: getEnvInt('PORT', 3000),
    nodeEnv: getEnvOptional('NODE_ENV', 'development'),
    database,
    github,
    scheduler,
    ai,
  };
}
