import { describe, expect, it } from 'vitest';
import { MoneyFormatter } from '../src/index.js';

describe('MoneyFormatter.compact', () => {
  it.each([
    [950, '€950'],
    [1_000, '€1k'],
    [12_500, '€12.5k'],
    [500_000, '€500k'],
    [999_999, '€1M'],
    [1_200_000, '€1.2M'],
    [1_666_667, '€1.67M'],
    [2_000_000, '€2M'],
  ])('formats %s as %s', (amount, expected) => {
    expect(MoneyFormatter.compact(amount)).toBe(expected);
  });

  it.each([0, 12.5, -100])('rejects %s', (amount) => {
    expect(() => MoneyFormatter.compact(amount)).toThrow(RangeError);
  });
});

describe('MoneyFormatter.full', () => {
  it.each([
    [950, '€950'],
    [500_000, '€500,000'],
    [1_500_000, '€1,500,000'],
  ])('formats %s as %s', (amount, expected) => {
    expect(MoneyFormatter.full(amount)).toBe(expected);
  });

  it.each([0, 12.5])('rejects %s', (amount) => {
    expect(() => MoneyFormatter.full(amount)).toThrow(RangeError);
  });
});
