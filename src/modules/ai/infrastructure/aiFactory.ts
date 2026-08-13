import { AIProvider } from '../application/aiProvider';
import { MinimaxAIProvider } from '../infrastructure/minimaxAIProvider';
import { GroqAIProvider } from '../infrastructure/groqAIProvider';
import { OpenAIProvider } from '../infrastructure/openAIProvider';
import { AIConfig } from '../../../config/types';
import { Logger } from '../../../shared/types/logger';
import { ValidationError } from '../../../shared/types/errors';
import { BaseAIProviderOptions } from '../infrastructure/baseAIProvider';

type ProviderName = AIConfig['provider'];

interface ProviderSpec {
  name: ProviderName;
  apiKey: string;
  factory: (apiKey: string) => AIProvider;
}

const FALLBACK_ORDER: ProviderName[] = ['minimax', 'groq', 'openai'];

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
  const providers: ProviderSpec[] = [
    { name: 'minimax', apiKey: config.minimaxApiKey, factory: (k) => new MinimaxAIProvider(k, logger, config.minimaxModel, providerOpts) },
    { name: 'groq', apiKey: config.groqApiKey, factory: (k) => new GroqAIProvider(k, logger, config.groqModel, providerOpts) },
    { name: 'openai', apiKey: config.openaiApiKey, factory: (k) => new OpenAIProvider(k, logger, config.openaiModel, providerOpts) },
  ];

  const configuredName = FALLBACK_ORDER.includes(config.provider) ? config.provider : null;

  if (configuredName) {
    const configured = providers.find((p) => p.name === configuredName)!;
    if (configured.apiKey) {
      return configured.factory(configured.apiKey);
    }
    logger.warn(
      `Configured LLM provider '${configuredName}' has no API key set; falling back to next available provider`,
      { module: 'ai-factory', configuredProvider: configuredName }
    );
  } else {
    logger.warn(`Unknown LLM_PROVIDER '${config.provider}'; falling back to next available provider`, {
      module: 'ai-factory',
      configuredProvider: config.provider,
    });
  }

  for (const name of FALLBACK_ORDER) {
    if (name === configuredName) continue;
    const candidate = providers.find((p) => p.name === name)!;
    if (candidate.apiKey) {
      logger.warn(`Using AI provider '${name}' as fallback`, {
        module: 'ai-factory',
        fallbackProvider: name,
        configuredProvider: configuredName,
      });
      return candidate.factory(candidate.apiKey);
    }
  }

  throw new ValidationError(
    `No AI provider API key configured. Set one of: ${providers
      .map((p) => `${p.name.toUpperCase()}_API_KEY`)
      .join(', ')}`
  );
}