import type { AppConfig } from '../../config/AppConfig.js';
import type { ProviderDeps } from '../ProviderDeps.js';
import { AnthropicThinkingProvider } from './AnthropicThinkingProvider.js';
import { FakeThinkingProvider } from './FakeThinkingProvider.js';
import { OllamaThinkingProvider } from './OllamaThinkingProvider.js';
import type { ThinkingProvider, ThinkingProviderName } from './ThinkingProvider.js';

/** Builds the configured thinking provider. A new provider = one class + one case here. */
export class ThinkingProviderFactory {
  static create(config: AppConfig, deps: ProviderDeps): ThinkingProvider {
    const { provider, providers } = config.llm.thinking;
    const name: ThinkingProviderName = provider;
    switch (name) {
      case 'ollama':
        return new OllamaThinkingProvider(providers.ollama, deps);
      case 'anthropic': {
        // Config validation guarantees the key for the active provider; this guards hand-built configs.
        const apiKey = config.secrets.anthropicApiKey;
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the anthropic thinking provider');
        return new AnthropicThinkingProvider(providers.anthropic, apiKey, deps);
      }
      case 'fake':
        return new FakeThinkingProvider();
      default:
        return ThinkingProviderFactory.unknown(name);
    }
  }

  private static unknown(name: never): never {
    throw new Error(`Unknown thinking provider: ${String(name)}`);
  }
}
