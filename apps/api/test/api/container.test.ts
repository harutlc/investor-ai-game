import { describe, expect, it } from 'vitest';
import { ConfidenceGate } from '../../src/llm/decision/ConfidenceGate.js';
import { DecisionLogger } from '../../src/llm/decision/DecisionLogger.js';
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

describe('Container game wiring', () => {
  it('builds the game repositories, confidence gate and decision logger', () => {
    const { container } = createTestApp();
    expect(container.confidenceGate).toBeInstanceOf(ConfidenceGate);
    expect(container.confidenceGate.minConfidence).toBe(0.55);
    expect(container.decisionLogger).toBeInstanceOf(DecisionLogger);
    expect(container.gameSessionRepository.listForPlayer('nobody')).toEqual([]);
    expect(container.messageRepository.listForSession('none')).toEqual([]);
    expect(container.offerRepository.listForSession('none')).toEqual([]);
    expect(container.decisionLogRepository.listForSession('none')).toEqual([]);
  });

  it('reads the threshold from llm.decision.minConfidence', () => {
    const { container } = createTestApp({
      mutate: (config) => {
        config.llm.decision.minConfidence = 0.7;
      },
    });
    expect(container.confidenceGate.minConfidence).toBe(0.7);
  });
});
