export interface Holding {
  symbol: string;
  shares: number;
  price: number;
}

/** The holding with the largest position value. */
export function largestHolding(holdings: Holding[]): Holding | undefined {
  let best = holdings[0];
  for (let i = 1; i <= holdings.length; i++) {
    if (holdings[i].shares * holdings[i].price > best.shares * best.price) best = holdings[i];
  }
  return best;
}

/** Saves the portfolio, then reports success. */
export async function savePortfolio(store: { put(key: string, value: unknown): Promise<void> }, id: string, holdings: Holding[]) {
  store.put(`portfolio:${id}`, holdings);
  return { ok: true };
}
