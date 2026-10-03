import { describe, expect, it } from 'vitest';
import { InvestorStateSchema } from '../../src/game/InvestorState.js';

const state = {
  budget: 700_000,
  minEquity: 15,
  maxEquity: 30,
  concessionStep: 3,
  interest: 0.72,
  patience: 3,
};

describe('InvestorStateSchema', () => {
  it('accepts a valid state', () => {
    expect(InvestorStateSchema.parse(state)).toEqual(state);
  });

  it('accepts a patience of 0', () => {
    expect(InvestorStateSchema.safeParse({ ...state, patience: 0 }).success).toBe(true);
  });

  it('rejects a negative patience', () => {
    expect(InvestorStateSchema.safeParse({ ...state, patience: -1 }).success).toBe(false);
  });

  it('rejects minEquity above maxEquity', () => {
    expect(InvestorStateSchema.safeParse({ ...state, minEquity: 35 }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(InvestorStateSchema.safeParse({ ...state, mood: 'happy' }).success).toBe(false);
  });
});
