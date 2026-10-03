import { OfferInputSchema } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { OpeningOfferCalculator } from '../../src/game/OpeningOfferCalculator.js';

const calculator = new OpeningOfferCalculator();

describe('OpeningOfferCalculator', () => {
  it("anchors at the maximum equity for the founder's ask", () => {
    const offer = calculator.offer({ askAmount: 500_000 }, { budget: 700_000, maxEquity: 30 });
    expect(offer).toEqual({ investment: 500_000, equity: 30 });
    expect(OfferInputSchema.safeParse(offer).success).toBe(true);
  });

  it('caps the investment at the budget', () => {
    expect(calculator.offer({ askAmount: 900_000 }, { budget: 600_000, maxEquity: 40 })).toEqual({
      investment: 600_000,
      equity: 40,
    });
  });
});
