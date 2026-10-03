import { describe, expect, it } from 'vitest';
import { ValuationCalculator } from '../src/index.js';

describe('ValuationCalculator', () => {
  it("computes the tutor's opening offer", () => {
    expect(ValuationCalculator.impliedPostMoney(500_000, 30)).toBe(1_666_667);
    expect(ValuationCalculator.impliedPreMoney(500_000, 30)).toBe(1_166_667);
  });

  it('computes a 15% counter', () => {
    expect(ValuationCalculator.impliedPostMoney(500_000, 15)).toBe(3_333_333);
  });

  it('round-trips equity and amount', () => {
    expect(ValuationCalculator.equityFor(500_000, 2_500_000)).toBe(20);
    expect(ValuationCalculator.amountFor(20, 2_500_000)).toBe(500_000);
  });

  it('rounds equity to 2 decimals', () => {
    expect(ValuationCalculator.equityFor(500_000, 3_000_000)).toBe(16.67);
  });

  it('throws on equity 0', () => {
    expect(() => ValuationCalculator.impliedPostMoney(500_000, 0)).toThrow(RangeError);
  });

  it('throws on a fractional investment', () => {
    expect(() => ValuationCalculator.impliedPostMoney(500_000.5, 20)).toThrow(RangeError);
  });

  it('throws when the amount is at or above the post-money valuation', () => {
    expect(() => ValuationCalculator.equityFor(2_500_000, 2_500_000)).toThrow(RangeError);
    expect(() => ValuationCalculator.equityFor(3_000_000, 2_500_000)).toThrow(RangeError);
  });

  it('throws on invalid amountFor inputs', () => {
    expect(() => ValuationCalculator.amountFor(100, 2_500_000)).toThrow(RangeError);
    expect(() => ValuationCalculator.amountFor(20, -1)).toThrow(RangeError);
  });
});
