import { describe, expect, it } from 'vitest';
import { InvestorBrain } from '../../src/brain/InvestorBrain.js';
import { NegotiationPolicy } from '../../src/game/NegotiationPolicy.js';
import { InvestorVoice } from '../../src/voice/InvestorVoice.js';
import { voiceContext } from '../support/voiceFixtures.js';
import { ConfidenceGate } from '../../src/llm/decision/ConfidenceGate.js';
import { DecisionLogger } from '../../src/llm/decision/DecisionLogger.js';
import { FakeDecisionProvider } from '../../src/llm/decision/FakeDecisionProvider.js';
import { SystemOneDecisionProvider } from '../../src/llm/decision/SystemOneDecisionProvider.js';
import { FakeThinkingProvider } from '../../src/llm/thinking/FakeThinkingProvider.js';
import { OllamaThinkingProvider } from '../../src/llm/thinking/OllamaThinkingProvider.js';
import { brainMove, brainPersona } from '../support/brainFixtures.js';
import { createTestApp } from '../support/createTestApp.js';
import { seedSession, sessionFixture } from '../support/gameFixtures.js';

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

  it('builds the investor brain with the MVP question sets, two per stage', () => {
    const { container } = createTestApp();
    expect(container.investorBrain).toBeInstanceOf(InvestorBrain);
    expect(container.questionSetRegistry.forStage('A').map((set) => set.id)).toEqual(['intent', 'offer']);
    expect(container.questionSetRegistry.forStage('B').map((set) => set.id)).toEqual(['deal', 'conduct']);
  });

  it('gives the state builder the configured turn limit', () => {
    const { container } = createTestApp({
      mutate: (config) => {
        config.game.maxTurns = 8;
      },
    });
    const session = sessionFixture('player-1', { turn: 3 });
    const state = container.negotiationStateBuilder.build({
      session,
      persona: brainPersona,
      earlierOffers: [],
    });
    expect(state.turns_left).toBe(5);
  });

  it('logs brain decisions through the container database', async () => {
    const { container } = createTestApp();
    const sessionId = seedSession(container.database).id;

    await container.investorBrain.evaluate({ sessionId, turn: 1, ...brainMove('Deal?') });

    expect(container.decisionLogRepository.listForSession(sessionId).map((entry) => entry.stage)).toEqual([
      'B',
      'B',
    ]);
  });

  it('builds the negotiation policy, meter hints and turn limiter from config.game', () => {
    const { container } = createTestApp({
      mutate: (config) => {
        config.game.maxTurns = 8;
      },
    });
    expect(container.negotiationPolicy).toBeInstanceOf(NegotiationPolicy);
    expect(container.turnLimiter.maxTurns).toBe(8);
    expect(container.turnLimiter.turnsLeft(3)).toBe(5);
    expect(container.meterHintMapper.toMeters({ interest: 0.5, patience: 2 })).toEqual({
      interestLevel: 'medium',
      patienceHint: 'Tapping the table',
    });
    const state = {
      budget: 700_000,
      minEquity: 20,
      maxEquity: 30,
      concessionStep: 4,
      interest: 0.5,
      patience: 4,
    };
    expect(container.investorStateUpdater.afterInjection(state).patience).toBe(3);
  });

  it('builds the opening offer calculator and the investor voice on the thinking provider', async () => {
    const thinkingProvider = new FakeThinkingProvider([
      "GreenCharge. €500k for 30%, and that's generous.",
      JSON.stringify({ options: [{ kind: 'message', label: 'Ask about the terms' }] }),
    ]);
    const { container } = createTestApp({ thinkingProvider });
    expect(container.investorVoice).toBeInstanceOf(InvestorVoice);

    const offer = container.openingOfferCalculator.offer(
      { askAmount: 500_000 },
      { budget: 700_000, maxEquity: 30 },
    );
    const turn = await container.investorVoice.open(voiceContext({ history: [] }), offer);

    expect(turn.line).toEqual({ text: "GreenCharge. €500k for 30%, and that's generous.", fallback: false });
    expect(turn.options.options.map((option) => option.label)).toEqual([
      'Ask about the terms',
      'Accept €500k for 30%',
      'Walk away',
    ]);
  });
});
