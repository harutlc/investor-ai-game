import { describe, expect, it } from 'vitest';
import { EquityPercentSchema, MoneySchema } from '../src/index.js';

describe('MoneySchema', () => {
  it('accepts whole euros', () => {
    expect(MoneySchema.safeParse(500_000).success).toBe(true);
  });

  it.each([500_000.5, 0, -1])('rejects %s', (value) => {
    expect(MoneySchema.safeParse(value).success).toBe(false);
  });
});

describe('EquityPercentSchema', () => {
  it.each([0.29, 15, 24.5, 99.99])('accepts %s', (value) => {
    expect(EquityPercentSchema.safeParse(value).success).toBe(true);
  });

  it.each([0, 100, 12.345, -5])('rejects %s', (value) => {
    expect(EquityPercentSchema.safeParse(value).success).toBe(false);
  });
});
