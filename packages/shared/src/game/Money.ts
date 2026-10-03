import { z } from 'zod';

/** Floating-point slack for the 2-decimal check (`0.29 * 100` is 28.999999999999996). */
const EPSILON = 1e-9;

/** True when `value` has at most 2 decimal places, tolerating binary floating-point noise. */
export function hasAtMostTwoDecimals(value: number): boolean {
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < EPSILON;
}

/** A positive whole number of euros. */
export const MoneySchema = z.number().int({ error: 'must be a whole number of euros' }).positive();

/** A share of the company in percent: above 0, below 100, at most 2 decimal places. */
export const EquityPercentSchema = z
  .number()
  .gt(0)
  .lt(100)
  .refine(hasAtMostTwoDecimals, { error: 'must have at most 2 decimal places' });

export type Money = z.infer<typeof MoneySchema>;
export type EquityPercent = z.infer<typeof EquityPercentSchema>;
