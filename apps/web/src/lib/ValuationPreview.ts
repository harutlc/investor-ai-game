import { EquityPercentSchema, MoneyFormatter, MoneySchema, ValuationCalculator } from '@investor/shared';

export interface OfferPreview {
  postMoney: number;
  preMoney: number;
  /** "€2.5M post · €2M pre". */
  valuationText: string;
  /** "Exactly your asked valuation", "+10% vs your asked €2M", "-25% vs your asked €2M". */
  versusAsk: string;
  direction: 'above' | 'below' | 'equal';
}

/** Live numbers for the pitch form and the offer form. Invalid input gives null, never a wrong number. */
export class ValuationPreview {
  static readonly MIN_EQUITY = 1;
  static readonly MAX_EQUITY = 60;
  static readonly EQUITY_STEP = 0.5;

  static isValidAmount(amount: number): boolean {
    return MoneySchema.safeParse(amount).success;
  }

  /** What an "€X for Y%" offer implies, compared with the founder's asked pre-money valuation. */
  static forOffer(investment: number, equity: number, askedValuation: number): OfferPreview | null {
    if (!ValuationPreview.isValidAmount(investment) || !EquityPercentSchema.safeParse(equity).success)
      return null;
    if (!ValuationPreview.isValidAmount(askedValuation)) return null;
    const postMoney = ValuationCalculator.impliedPostMoney(investment, equity);
    const preMoney = postMoney - investment;
    if (preMoney <= 0) return null;
    const difference = Math.round((preMoney / askedValuation - 1) * 100);
    const asked = MoneyFormatter.compact(askedValuation);
    return {
      postMoney,
      preMoney,
      valuationText: `${MoneyFormatter.compact(postMoney)} post · ${MoneyFormatter.compact(preMoney)} pre`,
      versusAsk:
        difference === 0
          ? 'Exactly your asked valuation'
          : `${difference > 0 ? '+' : ''}${difference}% vs your asked ${asked}`,
      direction: difference > 0 ? 'above' : difference < 0 ? 'below' : 'equal',
    };
  }

  /** The equity the ask buys at the asked pre-money valuation: ask ÷ (valuation + ask), 2 decimals. */
  static askEquity(askAmount: number, valuation: number): number | null {
    if (!ValuationPreview.isValidAmount(askAmount) || !ValuationPreview.isValidAmount(valuation)) return null;
    return Math.round((askAmount / (valuation + askAmount)) * 100 * 100) / 100;
  }

  /** "€500k for 20% at your valuation". */
  static askHint(askAmount: number, valuation: number): string | null {
    const equity = ValuationPreview.askEquity(askAmount, valuation);
    return equity === null ? null : `${MoneyFormatter.compact(askAmount)} for ${equity}% at your valuation`;
  }

  /** "€2M before the investment". */
  static valuationHint(valuation: number): string | null {
    return ValuationPreview.isValidAmount(valuation)
      ? `${MoneyFormatter.compact(valuation)} before the investment`
      : null;
  }

  /** The offer form's starting equity: the ask's equity on the slider's 0.5-point grid. */
  static defaultEquity(askAmount: number, valuation: number): number {
    const equity = ValuationPreview.askEquity(askAmount, valuation) ?? 20;
    return ValuationPreview.toSliderValue(equity);
  }

  /** Rounds to the nearest 0.5 point within the slider's range. */
  static toSliderValue(equity: number): number {
    const stepped = Math.round(equity / ValuationPreview.EQUITY_STEP) * ValuationPreview.EQUITY_STEP;
    return Math.min(ValuationPreview.MAX_EQUITY, Math.max(ValuationPreview.MIN_EQUITY, stepped));
  }
}
