import { MoneySchema } from './Money.js';

/**
 * Euro formatting shared by the API (decision state, dialogue) and the UI, so an amount reads the same
 * everywhere. Invalid amounts throw a RangeError instead of returning text.
 */
export class MoneyFormatter {
  /** `€950`, `€500k`, `€12.5k`, `€1.67M`, `€2M`. Rounds up into the next unit: €999,999 is `€1M`. */
  static compact(amount: number): string {
    MoneyFormatter.requireMoney(amount);
    if (amount < 1_000) return `€${amount}`;
    const thousands = MoneyFormatter.round(amount / 1_000, 1);
    if (thousands < 1_000) return `€${thousands}k`;
    return `€${MoneyFormatter.round(amount / 1_000_000, 2)}M`;
  }

  /** `€500,000`. Locale-independent. */
  static full(amount: number): string {
    MoneyFormatter.requireMoney(amount);
    return `€${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  }

  /** Rounded to `decimals`; printing the number drops trailing zeros (1.50 → "1.5", 2.00 → "2"). */
  private static round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  private static requireMoney(amount: number): void {
    if (!MoneySchema.safeParse(amount).success) {
      throw new RangeError(`amount must be a positive whole number of euros, got ${amount}`);
    }
  }
}
