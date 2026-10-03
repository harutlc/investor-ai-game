import { EquityPercentSchema, MoneySchema } from './Money.js';

/**
 * Valuation math shared by the API and the UI. Money is rounded to the nearest euro, equity to 2 decimals.
 * "Post-money" is what an "€X for Y%" offer implies; "pre-money" is that minus the investment.
 * Invalid inputs throw a RangeError instead of returning a number.
 */
export class ValuationCalculator {
  /** investment ÷ (equity ÷ 100). €500k for 30% → €1,666,667. */
  static impliedPostMoney(investment: number, equity: number): number {
    ValuationCalculator.requireMoney('investment', investment);
    ValuationCalculator.requireEquity(equity);
    return Math.round(investment / (equity / 100));
  }

  /** Post-money − investment. €500k for 30% → €1,166,667. */
  static impliedPreMoney(investment: number, equity: number): number {
    return ValuationCalculator.impliedPostMoney(investment, equity) - investment;
  }

  /** The equity percentage `amount` buys at `postMoney`. */
  static equityFor(amount: number, postMoney: number): number {
    ValuationCalculator.requireMoney('amount', amount);
    ValuationCalculator.requireMoney('postMoney', postMoney);
    if (amount >= postMoney) throw new RangeError('amount must be below the post-money valuation');
    const equity = Math.round((amount / postMoney) * 100 * 100) / 100;
    ValuationCalculator.requireEquity(equity, 'resulting equity');
    return equity;
  }

  /** The amount that buys `equity` percent at `postMoney`. */
  static amountFor(equity: number, postMoney: number): number {
    ValuationCalculator.requireEquity(equity);
    ValuationCalculator.requireMoney('postMoney', postMoney);
    const amount = Math.round((postMoney * equity) / 100);
    ValuationCalculator.requireMoney('resulting amount', amount);
    return amount;
  }

  private static requireMoney(name: string, value: number): void {
    if (!MoneySchema.safeParse(value).success) {
      throw new RangeError(`${name} must be a positive whole number of euros, got ${value}`);
    }
  }

  private static requireEquity(value: number, name = 'equity'): void {
    if (!EquityPercentSchema.safeParse(value).success) {
      throw new RangeError(`${name} must be above 0 and below 100 with at most 2 decimals, got ${value}`);
    }
  }
}
