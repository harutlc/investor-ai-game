import type { AppConfig } from '../../config/AppConfig.js';
import type { ProviderDeps } from '../ProviderDeps.js';
import type { DecisionProvider, DecisionProviderName } from './DecisionProvider.js';
import { FakeDecisionProvider } from './FakeDecisionProvider.js';
import { SystemOneDecisionProvider } from './SystemOneDecisionProvider.js';

/** Builds the configured decision provider. A new provider = one class + one case here. */
export class DecisionProviderFactory {
  static create(config: AppConfig, deps: ProviderDeps): DecisionProvider {
    const { provider, providers } = config.llm.decision;
    const name: DecisionProviderName = provider;
    switch (name) {
      case 'jev': {
        // Config validation guarantees the key for the active provider; this guards hand-built configs.
        const apiKey = config.secrets.typesafeApiKey;
        if (!apiKey) throw new Error('TYPESAFE_API_KEY is required for the jev decision provider');
        return new SystemOneDecisionProvider('jev', providers.jev, apiKey, deps);
      }
      case 'laya':
        return new SystemOneDecisionProvider('laya', providers.laya, config.secrets.layaApiKey, deps);
      case 'fake':
        return new FakeDecisionProvider();
      default:
        return DecisionProviderFactory.unknown(name);
    }
  }

  private static unknown(name: never): never {
    throw new Error(`Unknown decision provider: ${String(name)}`);
  }
}
