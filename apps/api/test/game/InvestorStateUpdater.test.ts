import { describe, expect, it } from 'vitest';
import { InvestorStateUpdater } from '../../src/game/InvestorStateUpdater.js';
import { investorState, judgment, settings } from '../support/policyFixtures.js';

const updater = new InvestorStateUpdater(settings);

describe('InvestorStateUpdater.afterMove', () => {
  it('raises interest by (good_deal - 0.5) x interestWeight', () => {
    const next = updater.afterMove(investorState({ interest: 0.5 }), {
      action: 'counter',
      judgment: judgment({ goodDeal: 0.9 }),
    });
    expect(next.interest).toBe(0.58);
  });

  it('keeps interest within 0 and 1', () => {
    const high = updater.afterMove(investorState({ interest: 0.99 }), {
      action: 'counter',
      judgment: judgment({ goodDeal: 1 }),
    });
    const low = updater.afterMove(investorState({ interest: 0.01 }), {
      action: 'counter',
      judgment: judgment({ goodDeal: 0 }),
    });
    expect([high.interest, low.interest]).toEqual([1, 0]);
  });

  it('adds the reject and insult costs', () => {
    const next = updater.afterMove(investorState({ patience: 4 }), {
      action: 'reject',
      judgment: judgment({ insult: 0.91 }),
    });
    expect(next.patience).toBe(1);
  });

  it('ignores an insult probability below the threshold', () => {
    const next = updater.afterMove(investorState({ patience: 4 }), {
      action: 'counter',
      judgment: judgment({ insult: 0.5 }),
    });
    expect(next.patience).toBe(4);
  });

  it('never lets patience go below 0', () => {
    const next = updater.afterMove(investorState({ patience: 1 }), {
      action: 'reject',
      judgment: judgment({ insult: 0.95 }),
    });
    expect(next.patience).toBe(0);
  });

  it('returns a new state and keeps the hidden limits', () => {
    const state = investorState();
    const before = structuredClone(state);
    const next = updater.afterMove(state, { action: 'reject', judgment: judgment({ goodDeal: 0.9 }) });
    expect(state).toEqual(before);
    expect(next).not.toBe(state);
    expect(next).toMatchObject({ budget: 700_000, minEquity: 20, maxEquity: 30, concessionStep: 4 });
  });
});

describe('InvestorStateUpdater.afterInjection', () => {
  it('costs the injection patience and leaves interest alone', () => {
    const next = updater.afterInjection(investorState({ patience: 4, interest: 0.6 }));
    expect(next).toMatchObject({ patience: 3, interest: 0.6 });
  });

  it('never lets patience go below 0', () => {
    expect(updater.afterInjection(investorState({ patience: 0 })).patience).toBe(0);
  });
});
