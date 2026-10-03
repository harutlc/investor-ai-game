import {
  DecisionInsightsDtoSchema,
  GameSessionDtoSchema,
  TurnResultDtoSchema,
  type CreateGameRequest,
  type DecisionAnswer,
} from '@investor/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { Container } from '../../src/container/Container.js';
import { GameNotFoundError } from '../../src/errors/GameNotFoundError.js';
import type { ThinkingProvider } from '../../src/llm/thinking/ThinkingProvider.js';
import { FakeDecisionProvider } from '../../src/llm/decision/FakeDecisionProvider.js';
import { choice, noul, score } from '../support/brainFixtures.js';
import { createTestApp } from '../support/createTestApp.js';
import { seedPlayer } from '../support/gameFixtures.js';
import { ScriptedThinkingProvider, UnavailableThinkingProvider } from '../support/thinkingFixtures.js';

const PITCH: CreateGameRequest['pitch'] = {
  name: 'GreenCharge',
  sector: 'EV charging',
  description: 'Fast chargers for apartment buildings.',
  valuation: 2_000_000,
  askAmount: 500_000,
};

let container: Container;
afterEach(() => container?.dispose());

function setup(thinkingProvider: ThinkingProvider) {
  const decisions = new FakeDecisionProvider();
  ({ container } = createTestApp({ decisionProvider: decisions, thinkingProvider }));
  return { decisions, playerId: seedPlayer(container.database), engine: container.gameEngine };
}

function stageB(
  reaction: string,
  extra: Record<string, DecisionAnswer> = {},
): Record<string, DecisionAnswer> {
  return {
    accept: score(1),
    reaction: choice(reaction),
    good_deal: noul(0.3),
    concession_size: choice('medium'),
    politeness: score(3),
    insult: noul(0.02),
    confidence: score(3),
    ...extra,
  };
}

describe('a full game with the fake providers', () => {
  it('ends in a deal: opening, free-text counter, investor counter, player accepts', async () => {
    const voice = new ScriptedThinkingProvider(
      [
        'Rex Calloway. €500k for 40%, take it or leave it.',
        'Twenty-five? Cute. €500k for 37%, and I am being generous.',
        'Smart move. Deal at €500k for 37%.',
      ],
      [
        JSON.stringify({
          options: [{ kind: 'counter', label: 'Counter: €500k for 30%', investment: 500_000, equity: 30 }],
        }),
        JSON.stringify({ options: [{ kind: 'message', label: 'Ask why 37%' }] }),
      ],
    );
    const { decisions, playerId, engine } = setup(voice);

    const opened = await engine.startGame(playerId, { personaId: 'greedy-shark', pitch: PITCH });
    expect(GameSessionDtoSchema.safeParse(opened).success).toBe(true);
    expect(opened.options.map((option) => option.label)).toEqual([
      'Counter: €500k for 30%',
      'Accept €500k for 40%',
      'Walk away',
    ]);

    // Turn 1: free text, so Stage A (intent + offer) and Stage B (deal + conduct) all run.
    const turn1Answers = {
      intent: choice('counter_offer'),
      injection: noul(0.02),
      investment: choice('€500,000'),
      equity: choice('25%'),
      ...stageB('counter'),
    };
    decisions.enqueue(turn1Answers, turn1Answers, turn1Answers, turn1Answers);
    const turn1 = await engine.playTurn(playerId, opened.id, {
      message: "€500k for 25%, we're growing fast.",
    });
    expect(TurnResultDtoSchema.safeParse(turn1).success).toBe(true);
    expect(turn1.session).toMatchObject({
      turn: 1,
      status: 'negotiating',
      currentInvestorOffer: { investment: 500_000, equity: 37 },
      lastPlayerOffer: { investment: 500_000, equity: 25 },
    });
    expect(turn1.newMessages[1]!.text).toBe('Twenty-five? Cute. €500k for 37%, and I am being generous.');

    // Turn 2: the player accepts the investor's offer.
    const accept = turn1.session.options.find((option) => option.kind === 'accept')!;
    expect(accept.label).toBe('Accept €500k for 37%');
    const turn2 = await engine.playTurn(playerId, opened.id, { optionId: accept.id });

    expect(turn2.session).toMatchObject({
      turn: 2,
      status: 'deal',
      phase: 'finished',
      currentInvestorOffer: { investment: 500_000, equity: 37 },
      options: [],
    });
    expect(turn2.session.messages.map((message) => message.role)).toEqual([
      'system',
      'investor',
      'player',
      'investor',
      'player',
      'investor',
    ]);
    expect(
      container.offerRepository
        .listForSession(opened.id)
        .map((offer) => [offer.turn, offer.from, offer.equity]),
    ).toEqual([
      [0, 'investor', 40],
      [1, 'player', 25],
      [1, 'investor', 37],
    ]);

    const insights = container.gameSessionService.getInsights(playerId, opened.id);
    expect(DecisionInsightsDtoSchema.safeParse(insights).success).toBe(true);
    expect(insights.entries.map((entry) => `${entry.turn}${entry.stage}`)).toEqual(['1A', '1A', '1B', '1B']);
  });

  it('ends in a walk-away when repeated rejections use up the patience', async () => {
    const { decisions, playerId, engine } = setup(new UnavailableThinkingProvider());
    const opened = await engine.startGame(playerId, { personaId: 'greedy-shark', pitch: PITCH });

    const reject = () => {
      decisions.enqueue(stageB('reject'));
      return engine.playTurn(playerId, opened.id, { offer: { investment: 500_000, equity: 10 } });
    };
    // The shark starts with patience 5; each rejection costs 1, so turns 1-4 keep the game going.
    for (let turn = 1; turn <= 4; turn++) {
      const { session } = await reject();
      expect(GameSessionDtoSchema.safeParse(session).success).toBe(true);
      expect(session.status).toBe('negotiating');
    }
    const result = await reject();

    expect(result.session).toMatchObject({ turn: 5, status: 'walked_away', phase: 'finished', options: [] });
    expect(result.newMessages[1]!.text).toBe("I think we're done here.");
    expect(container.gameSessionRepository.findForPlayer(opened.id, playerId)?.investorState.patience).toBe(
      0,
    );
  });

  it('keeps a game private to its player', async () => {
    const { playerId, engine } = setup(new UnavailableThinkingProvider());
    const opened = await engine.startGame(playerId, { personaId: 'generous-angel', pitch: PITCH });
    const stranger = seedPlayer(container.database);

    expect(() => container.gameSessionService.getSession(stranger, opened.id)).toThrow(GameNotFoundError);
    await expect(
      engine.playTurn(stranger, opened.id, { offer: { investment: 500_000, equity: 15 } }),
    ).rejects.toThrow(GameNotFoundError);
    expect(new GameNotFoundError().code).toBe('NOT_FOUND');
  });
});
