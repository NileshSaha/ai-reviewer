import { AIProvider } from '../application/aiProvider';
import { MinimaxAIProvider } from '../infrastructure/minimaxAIProvider';
import { GeminiAIProvider } from '../infrastructure/geminiAIProvider';
import { OpenRouterAIProvider } from '../infrastructure/openrouterAIProvider';
import { GroqAIProvider } from '../infrastructure/groqAIProvider';
import { OpenAIProvider } from '../infrastructure/openAIProvider';
import { FallbackAIProvider, ProviderEntry } from '../infrastructure/fallbackAIProvider';
import { AIConfig } from '../../../config/types';
import { Logger } from '../../../shared/types/logger';
import { ValidationError } from '../../../shared/types/errors';
import { BaseAIProviderOptions } from '../infrastructure/baseAIProvider';

type ProviderName = AIConfig['provider'];

interface CandidateSpec {
  id: string;
  providerType: ProviderName;
  displayName: string;
  apiKey: string | undefined;
  create: (key: string) => AIProvider;
}

const DEFAULT_PRIORITY_ORDER = [
  'minimax-1',
  'minimax-2',
  'gemini',
  'openrouter',
  'groq',
  'openai',
];

function buildProviderOptions(config: AIConfig): BaseAIProviderOptions {
  return {
    maxPromptTokens: config.maxPromptTokens,
    maxResponseTokens: config.maxResponseTokens,
    maxPatchCharsPerFile: config.maxPatchCharsPerFile,
    charsPerToken: 4,
  };
}

export function createAIProvider(config: AIConfig, logger: Logger): AIProvider {
  const providerOpts = buildProviderOptions(config);

  const candidates: CandidateSpec[] = [
    {
      id: 'minimax-1',
      providerType: 'minimax',
      displayName: 'minimax-user1',
      apiKey: config.minimaxApiKey || undefined,
      create: (key) =>
        new MinimaxAIProvider(key, logger, config.minimaxModel, config.minimaxEndpoint, providerOpts),
    },
    {
      id: 'minimax-2',
      providerType: 'minimax',
      displayName: 'minimax-user2',
      apiKey: config.minimaxApiKey2 || undefined,
      create: (key) =>
        new MinimaxAIProvider(key, logger, config.minimaxModel, config.minimaxEndpoint, providerOpts),
    },
    {
      id: 'gemini',
      providerType: 'gemini',
      displayName: 'gemini',
      apiKey: config.geminiApiKey || undefined,
      create: (key) =>
        new GeminiAIProvider(key, logger, config.geminiModel, config.geminiEndpoint, providerOpts),
    },
    {
      id: 'openrouter',
      providerType: 'openrouter',
      displayName: 'openrouter',
      apiKey: config.openrouterApiKey || undefined,
      create: (key) =>
        new OpenRouterAIProvider(key, logger, config.openrouterModel, config.openrouterEndpoint, providerOpts),
    },
    {
      id: 'groq',
      providerType: 'groq',
      displayName: 'groq',
      apiKey: config.groqApiKey || undefined,
      create: (key) =>
        new GroqAIProvider(key, logger, config.groqModel, config.groqEndpoint, providerOpts),
    },
    {
      id: 'openai',
      providerType: 'openai',
      displayName: 'openai',
      apiKey: config.openaiApiKey || undefined,
      create: (key) =>
        new OpenAIProvider(key, logger, config.openaiModel, config.openaiEndpoint, providerOpts),
    },
  ];

  // Determine priority order: promote configured LLM_PROVIDER to top if set
  const configuredType = config.provider;
  const prioritizedCandidates: CandidateSpec[] = [];

  // 1. First add candidate(s) matching the configured provider
  for (const candidate of candidates) {
    if (candidate.providerType === configuredType && candidate.apiKey) {
      prioritizedCandidates.push(candidate);
    }
  }

  // 2. Then add the remaining candidates in DEFAULT_PRIORITY_ORDER
  for (const id of DEFAULT_PRIORITY_ORDER) {
    const candidate = candidates.find((c) => c.id === id);
    if (
      candidate &&
      candidate.apiKey &&
      !prioritizedCandidates.some((p) => p.id === candidate.id)
    ) {
      prioritizedCandidates.push(candidate);
    }
  }

  if (prioritizedCandidates.length === 0) {
    throw new ValidationError(
      'No AI provider API key configured. Set at least one of: MINIMAX_API_KEY, MINIMAX_API_KEY_2, GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OPENAI_API_KEY'
    );
  }

  const activeEntries: ProviderEntry[] = prioritizedCandidates.map((c) => ({
    name: c.displayName,
    provider: c.create(c.apiKey!),
  }));

  logger.info(
    `AI Provider chain initialized with ${activeEntries.length} provider(s): ${activeEntries
      .map((e) => e.name)
      .join(' -> ')}`,
    {
      module: 'ai-factory',
      primaryProvider: activeEntries[0].name,
      totalConfigured: activeEntries.length,
    }
  );

  if (activeEntries.length === 1) {
    return activeEntries[0].provider;
  }

  return new FallbackAIProvider(activeEntries, logger);
}