import { OfferInputSchema, type OfferInput } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import type { ConcessionSize } from '../../src/brain/InvestorJudgment.js';
import type { InvestorAction } from '../../src/game/InvestorAction.js';
import type { InvestorState } from '../../src/game/InvestorState.js';
import { InvestorStateUpdater } from '../../src/game/InvestorStateUpdater.js';
import { NegotiationPolicy } from '../../src/game/NegotiationPolicy.js';
import { investorState, judgment, settings, type JudgmentInput } from '../support/policyFixtures.js';

const policy = new NegotiationPolicy(settings, new InvestorStateUpdater(settings));
const opening: OfferInput = { investment: 500_000, equity: 30 };

function decide(
  input: JudgmentInput,
  playerOffer: OfferInput | null,
  state: InvestorState = investorState(),
  currentOffer: OfferInput = opening,
) {
  return policy.decide({ judgment: judgment(input), investorState: state, currentOffer, playerOffer });
}

function offerOf(action: InvestorAction): OfferInput {
  if (action.kind === 'walk_away') throw new Error('expected an action with an offer');
  return action.offer;
}

describe('NegotiationPolicy.decide: choosing the action', () => {
  it('accepts an offer inside the limits', () => {
    const { action } = decide(
      { reaction: 'accept', accept: 3.4, goodDeal: 0.71 },
      { investment: 550_000, equity: 22 },
      investorState({ budget: 600_000, minEquity: 22, maxEquity: 40 }),
    );
    expect(action).toEqual({ kind: 'accept', offer: { investment: 550_000, equity: 22 } });
  });

  it('downgrades accept to counter below the minimum equity', () => {
    const { action } = decide(
      { reaction: 'accept', accept: 3.8, goodDeal: 0.9 },
      { investment: 500_000, equity: 15 },
    );
    expect(action.kind).toBe('counter');
  });

  it('downgrades accept to counter when the scores are too low', () => {
    const offer = { investment: 500_000, equity: 25 };
    expect(decide({ reaction: 'accept', accept: 2.5, goodDeal: 0.9 }, offer).action.kind).toBe('counter');
    expect(decide({ reaction: 'accept', accept: 3.5, goodDeal: 0.4 }, offer).action.kind).toBe('counter');
  });

  it('downgrades accept to counter above the budget', () => {
    const { action } = decide(
      { reaction: 'accept', accept: 3.8, goodDeal: 0.9 },
      { investment: 800_000, equity: 25 },
    );
    expect(action).toEqual({ kind: 'counter', offer: { investment: 700_000, equity: 25 } });
  });

  it('asks for clarification when the reaction is uncertain, keeping offer and patience', () => {
    const outcome = decide(
      { reaction: 'counter', reactionConfidence: 0.4 },
      { investment: 500_000, equity: 15 },
    );
    expect(outcome.action).toEqual({ kind: 'clarify', offer: opening });
    expect(outcome.investorState.patience).toBe(4);
  });

  it('rejects a move without an offer, costing patience', () => {
    const outcome = decide({ reaction: 'counter' }, null);
    expect(outcome.action).toEqual({ kind: 'reject', offer: opening });
    expect(outcome.investorState.patience).toBe(3);
  });

  it('repeats the current offer on reject', () => {
    expect(decide({ reaction: 'reject' }, { investment: 500_000, equity: 10 }).action).toEqual({
      kind: 'reject',
      offer: opening,
    });
  });

  it('only walks away when confident enough', () => {
    const offer = { investment: 500_000, equity: 10 };
    expect(decide({ reaction: 'walk_away', reactionConfidence: 0.6 }, offer).action.kind).toBe('reject');
    expect(decide({ reaction: 'walk_away', reactionConfidence: 0.8 }, offer).action).toEqual({
      kind: 'walk_away',
      reason: 'decided',
    });
  });

  it('walks away when a rejection empties patience', () => {
    const outcome = decide(
      { reaction: 'reject' },
      { investment: 500_000, equity: 10 },
      investorState({ patience: 1 }),
    );
    expect(outcome.action).toEqual({ kind: 'walk_away', reason: 'out_of_patience' });
    expect(outcome.investorState.patience).toBe(0);
  });

  it('walks away when an insult empties patience, even while countering', () => {
    const outcome = decide(
      { reaction: 'counter', insult: 0.91 },
      { investment: 500_000, equity: 15 },
      investorState({ patience: 2 }),
    );
    expect(outcome.action).toEqual({ kind: 'walk_away', reason: 'out_of_patience' });
  });

  it('still closes a deal when the move empties patience', () => {
    const outcome = decide(
      { reaction: 'accept', accept: 3.8, goodDeal: 0.9, insult: 0.95 },
      { investment: 500_000, equity: 25 },
      investorState({ patience: 2 }),
    );
    expect(outcome.action.kind).toBe('accept');
  });

  it('only ever carries valid offers', () => {
    const cases: [JudgmentInput, OfferInput | null][] = [
      [
        { reaction: 'accept', accept: 4, goodDeal: 1 },
        { investment: 500_000, equity: 25 },
      ],
      [
        { reaction: 'counter', concession: 'large' },
        { investment: 450_000, equity: 12.5 },
      ],
      [{ reaction: 'reject' }, { investment: 500_000, equity: 10 }],
      [{ reaction: 'counter', reactionConfidence: 0.3 }, null],
    ];
    for (const [input, offer] of cases) {
      expect(OfferInputSchema.safeParse(offerOf(decide(input, offer).action)).success).toBe(true);
    }
  });
});

describe('NegotiationPolicy.decide: counter-offer math', () => {
  it.each<[string, number, OfferInput, ConcessionSize, Partial<InvestorState>, OfferInput]>([
    [
      "tutor's counter",
      30,
      { investment: 500_000, equity: 15 },
      'medium',
      {},
      { investment: 500_000, equity: 22 },
    ],
    [
      'never past the player',
      30,
      { investment: 500_000, equity: 28 },
      'large',
      {},
      { investment: 500_000, equity: 28 },
    ],
    [
      'kept above the minimum',
      30,
      { investment: 500_000, equity: 15 },
      'large',
      { minEquity: 25 },
      { investment: 500_000, equity: 25 },
    ],
    [
      'toward a generous player',
      30,
      { investment: 500_000, equity: 35 },
      'small',
      { maxEquity: 40 },
      { investment: 500_000, equity: 34 },
    ],
    [
      'no concession',
      30,
      { investment: 500_000, equity: 15 },
      'none',
      {},
      { investment: 500_000, equity: 30 },
    ],
    ['budget cap', 30, { investment: 800_000, equity: 15 }, 'small', {}, { investment: 700_000, equity: 26 }],
    [
      '2-decimal rounding',
      30,
      { investment: 500_000, equity: 15 },
      'small',
      { concessionStep: 1.333 },
      { investment: 500_000, equity: 28.67 },
    ],
  ])('%s', (_name, investorEquity, player, concession, state, expected) => {
    const { action } = decide({ reaction: 'counter', concession }, player, investorState(state), {
      investment: 500_000,
      equity: investorEquity,
    });
    expect(action).toEqual({ kind: 'counter', offer: expected });
  });
});

describe('NegotiationPolicy.guard', () => {
  const guard = (injection: number, state = investorState()) =>
    policy.guard({
      interpretation: {
        injection: { value: injection, confidence: Math.max(injection, 1 - injection), uncertain: false },
      },
      investorState: state,
      currentOffer: opening,
    });

  it('dismisses a manipulation attempt and costs patience', () => {
    expect(guard(0.93)).toEqual({
      action: { kind: 'dismiss', offer: opening },
      investorState: investorState({ patience: 3 }),
    });
  });

  it('lets a normal move through', () => {
    expect(guard(0.2)).toBeNull();
  });

  it('walks away when the attempt empties patience', () => {
    expect(guard(0.93, investorState({ patience: 1 }))?.action).toEqual({
      kind: 'walk_away',
      reason: 'out_of_patience',
    });
  });
});
