import { describe, expect, it } from 'vitest';
import { OfferFormatter } from '@/lib/OfferFormatter';
import { ValuationPreview } from '@/lib/ValuationPreview';

describe('OfferFormatter', () => {
  it('formats an offer and its valuation', () => {
    const offer = { investment: 500_000, equity: 30 };
    expect(OfferFormatter.short(offer)).toBe('€500k for 30%');
    expect(OfferFormatter.valuation(offer)).toBe('€1.67M post · €1.17M pre');
  });

  it('describes the gap between two offers', () => {
    expect(OfferFormatter.gap({ investment: 500_000, equity: 26 }, { investment: 500_000, equity: 20 })).toBe(
      'Gap: 6 equity points, €0 in amount',
    );
    expect(OfferFormatter.gap({ investment: 550_000, equity: 23 }, { investment: 500_000, equity: 22 })).toBe(
      'Gap: 1 equity point, €50k in amount',
    );
  });
});

describe('ValuationPreview', () => {
  it('previews an offer at the asked valuation', () => {
    expect(ValuationPreview.forOffer(500_000, 20, 2_000_000)).toMatchObject({
      postMoney: 2_500_000,
      preMoney: 2_000_000,
      valuationText: '€2.5M post · €2M pre',
      versusAsk: 'Exactly your asked valuation',
      direction: 'equal',
    });
  });

  it('shows the difference from the ask', () => {
    expect(ValuationPreview.forOffer(550_000, 20, 2_000_000)).toMatchObject({
      versusAsk: '+10% vs your asked €2M',
      direction: 'above',
    });
    expect(ValuationPreview.forOffer(500_000, 30, 2_000_000)).toMatchObject({
      versusAsk: '-42% vs your asked €2M',
      direction: 'below',
    });
  });

  it('gives no preview for invalid input', () => {
    expect(ValuationPreview.forOffer(0, 20, 2_000_000)).toBeNull();
    expect(ValuationPreview.forOffer(500_000.5, 20, 2_000_000)).toBeNull();
    expect(ValuationPreview.forOffer(500_000, 0, 2_000_000)).toBeNull();
    expect(ValuationPreview.forOffer(Number.NaN, 20, 2_000_000)).toBeNull();
  });

  it('hints what the ask buys', () => {
    expect(ValuationPreview.valuationHint(2_000_000)).toBe('€2M before the investment');
    expect(ValuationPreview.askHint(500_000, 2_000_000)).toBe('€500k for 20% at your valuation');
    expect(ValuationPreview.askHint(0, 2_000_000)).toBeNull();
  });

  it('starts the slider at the ask equity on the 0.5 grid', () => {
    expect(ValuationPreview.defaultEquity(500_000, 2_000_000)).toBe(20);
    expect(ValuationPreview.defaultEquity(300_000, 1_000_000)).toBe(23); // 23.08%
    expect(ValuationPreview.defaultEquity(250_000, 1_000_000)).toBe(20);
    expect(ValuationPreview.toSliderValue(17.3)).toBe(17.5);
    expect(ValuationPreview.toSliderValue(95)).toBe(60);
  });
});
