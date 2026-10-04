import { MoneyFormatter, ValuationCalculator, type OfferInput } from '@investor/shared';

/** "€X for Y%" offers as the screens show them. Same math and rounding as the API's voice checks. */
export class OfferFormatter {
  /** "€500k for 30%". */
  static short(offer: OfferInput): string {
    return `${MoneyFormatter.compact(offer.investment)} for ${offer.equity}%`;
  }

  /** "€1.67M post · €1.17M pre". */
  static valuation(offer: OfferInput): string {
    const post = ValuationCalculator.impliedPostMoney(offer.investment, offer.equity);
    return `${MoneyFormatter.compact(post)} post · ${MoneyFormatter.compact(post - offer.investment)} pre`;
  }

  /** "Gap: 6 equity points, €0 in amount". */
  static gap(investor: OfferInput, player: OfferInput): string {
    const points = Math.round(Math.abs(investor.equity - player.equity) * 100) / 100;
    const amount = Math.abs(investor.investment - player.investment);
    const amountText = amount === 0 ? '€0' : MoneyFormatter.compact(amount);
    return `Gap: ${points} equity ${points === 1 ? 'point' : 'points'}, ${amountText} in amount`;
  }
}
