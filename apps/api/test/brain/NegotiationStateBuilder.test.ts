import { DecisionStateSchema, type Offer } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { NegotiationStateBuilder } from '../../src/brain/NegotiationStateBuilder.js';
import { InvestorPersona } from '../../src/personas/InvestorPersona.js';
import { sessionFixture } from '../support/gameFixtures.js';
import { definition } from '../support/personaFixtures.js';

const persona = new InvestorPersona(definition);
const builder = new NegotiationStateBuilder(15);

/** The tutor's example: budget €700k, equity 20–30%, interest 0.72, patience 3, opening €500k for 30%. */
const session = sessionFixture('player-1', {
  turn: 1,
  investorState: {
    budget: 700_000,
    minEquity: 20,
    maxEquity: 30,
    concessionStep: 3,
    interest: 0.72,
    patience: 3,
  },
});
const opening: Offer = session.currentInvestorOffer!;

function offer(from: Offer['from'], equity: number): Pick<Offer, 'from' | 'investment' | 'equity'> {
  return { from, investment: 500_000, equity };
}

describe('NegotiationStateBuilder', () => {
  it("builds the tutor's example state", () => {
    const state = builder.build({
      session,
      persona,
      playerOffer: { investment: 500_000, equity: 15 },
      earlierOffers: [opening],
    });

    expect(state.player_offer).toEqual({
      investment: 500_000,
      equity: 15,
      implied_valuation: 3_333_333,
      within_budget: true,
      meets_min_equity: false,
    });
    expect(state.investor).toEqual({
      personality: persona.personality,
      goals: [...persona.goals],
      budget: 700_000,
      min_equity: 20,
      max_equity: 30,
      interest: 0.72,
      patience: 3,
      current_offer: { investment: 500_000, equity: 30 },
    });
    expect(state.history).toEqual(['Investor offered €500k for 30%']);
    expect(state).toMatchObject({ phase: 'term_negotiation', turn: 1, turns_left: 14 });
    expect(state.startup).toEqual({
      name: 'GreenCharge',
      sector: 'EV charging',
      pitch: 'Fast chargers for apartment buildings.',
      valuation_ask: 2_000_000,
      ask_amount: 500_000,
    });
  });

  it('never includes the concession step', () => {
    const state = builder.build({ session, persona, earlierOffers: [] });
    expect(JSON.stringify(state)).not.toMatch(/concession/i);
  });

  it('leaves out player_offer for a message-only move', () => {
    const state = builder.build({
      session,
      persona,
      playerMessage: 'Can you tell me more about your fund?',
      earlierOffers: [opening],
    });
    expect(state.player_message).toBe('Can you tell me more about your fund?');
    expect('player_offer' in state).toBe(false);
    expect('player_intent' in state).toBe(false);
  });

  it('adds the Stage A intent once known', () => {
    const state = builder.build({ session, persona, playerIntent: 'counter_offer', earlierOffers: [] });
    expect(state.player_intent).toBe('counter_offer');
  });

  it('leaves out current_offer before the investor has made one', () => {
    const state = builder.build({
      session: { ...session, currentInvestorOffer: null },
      persona,
      earlierOffers: [],
    });
    expect('current_offer' in state.investor).toBe(false);
  });

  it('uses countered when answering the other side, offered otherwise', () => {
    const state = builder.build({
      session,
      persona,
      earlierOffers: [
        offer('investor', 30),
        offer('player', 12),
        offer('investor', 26),
        offer('investor', 25),
      ],
    });
    expect(state.history).toEqual([
      'Investor offered €500k for 30%',
      'Player countered €500k for 12%',
      'Investor countered €500k for 26%',
      'Investor offered €500k for 25%',
    ]);
  });

  it('keeps the 10 most recent offers, oldest first', () => {
    const offers = Array.from({ length: 14 }, (_, index) =>
      offer(index % 2 === 0 ? 'investor' : 'player', 10 + index),
    );
    const state = builder.build({ session, persona, earlierOffers: offers });
    expect(state.history).toHaveLength(10);
    expect(state.history[0]).toBe('Investor countered €500k for 14%');
    expect(state.history[9]).toBe('Player countered €500k for 23%');
  });

  it('never reports negative turns left', () => {
    const state = builder.build({ session: { ...session, turn: 20 }, persona, earlierOffers: [] });
    expect(state.turns_left).toBe(0);
  });

  it('prints decimal equity without trailing zeros', () => {
    const state = builder.build({ session, persona, earlierOffers: [offer('investor', 22.5)] });
    expect(state.history).toEqual(['Investor offered €500k for 22.5%']);
  });

  it('always builds a valid decision state', () => {
    const states = [
      builder.build({ session, persona, earlierOffers: [] }),
      builder.build({
        session,
        persona,
        playerOffer: { investment: 800_000, equity: 25 },
        playerMessage: '€800k for 25%',
        playerIntent: 'counter_offer',
        earlierOffers: [opening],
      }),
    ];
    for (const state of states) expect(DecisionStateSchema.safeParse(state).success).toBe(true);
    expect(states[1]!.player_offer).toMatchObject({ within_budget: false, meets_min_equity: true });
  });
});
