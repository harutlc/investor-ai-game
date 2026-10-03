import { describe, expect, it } from 'vitest';
import { FakeDecisionProvider } from '../../src/llm/decision/FakeDecisionProvider.js';
import { SystemOneDecisionProvider } from '../../src/llm/decision/SystemOneDecisionProvider.js';
import { FakeThinkingProvider } from '../../src/llm/thinking/FakeThinkingProvider.js';
import { OllamaThinkingProvider } from '../../src/llm/thinking/OllamaThinkingProvider.js';
import { createTestApp } from '../support/createTestApp.js';

describe('Container LLM wiring', () => {
  it('uses fake providers by default in tests', () => {
    const { container } = createTestApp();
    expect(container.thinkingProvider).toBeInstanceOf(FakeThinkingProvider);
    expect(container.decisionProvider).toBeInstanceOf(FakeDecisionProvider);
  });

  it('accepts injected providers', () => {
    const thinkingProvider = new FakeThinkingProvider(['scripted']);
    const decisionProvider = new FakeDecisionProvider();
    const { container } = createTestApp({ thinkingProvider, decisionProvider });
    expect(container.thinkingProvider).toBe(thinkingProvider);
    expect(container.decisionProvider).toBe(decisionProvider);
  });

  it('builds the configured real providers through the factories', () => {
    const { container } = createTestApp({
      mutate: (config) => {
        config.llm.thinking.provider = 'ollama';
        config.llm.decision.provider = 'laya';
      },
    });
    expect(container.thinkingProvider).toBeInstanceOf(OllamaThinkingProvider);
    expect(container.decisionProvider).toBeInstanceOf(SystemOneDecisionProvider);
    expect(container.decisionProvider.name).toBe('laya');
  });
});
