import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../src/config/AppConfig.js';
import { AnthropicThinkingProvider } from '../../../src/llm/thinking/AnthropicThinkingProvider.js';
import { FakeThinkingProvider } from '../../../src/llm/thinking/FakeThinkingProvider.js';
import { OllamaThinkingProvider } from '../../../src/llm/thinking/OllamaThinkingProvider.js';
import { ThinkingProviderFactory } from '../../../src/llm/thinking/ThinkingProviderFactory.js';
import { testConfig } from '../../support/testConfig.js';

const deps = { logger: pino({ level: 'silent' }) };

function configWith(provider: string, anthropicApiKey?: string): AppConfig {
  return testConfig({
    mutate: (config) => {
      (config.llm.thinking as { provider: string }).provider = provider;
      if (anthropicApiKey) config.secrets.anthropicApiKey = anthropicApiKey;
    },
  });
}

describe('ThinkingProviderFactory', () => {
  it('builds Ollama with its settings', () => {
    const provider = ThinkingProviderFactory.create(configWith('ollama'), deps);
    expect(provider).toBeInstanceOf(OllamaThinkingProvider);
    expect(provider.model).toBe('llama3.1:8b');
  });

  it('builds Anthropic with its key', () => {
    const provider = ThinkingProviderFactory.create(configWith('anthropic', 'sk-ant-x'), deps);
    expect(provider).toBeInstanceOf(AnthropicThinkingProvider);
    expect(provider.model).toBe('claude-opus-5-5');
  });

  it('refuses Anthropic without a key', () => {
    expect(() => ThinkingProviderFactory.create(configWith('anthropic'), deps)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('builds the fake provider', () => {
    expect(ThinkingProviderFactory.create(configWith('fake'), deps)).toBeInstanceOf(FakeThinkingProvider);
  });

  it('throws on an unknown provider', () => {
    expect(() => ThinkingProviderFactory.create(configWith('gemini'), deps)).toThrow(
      /Unknown thinking provider: gemini/,
    );
  });
});
