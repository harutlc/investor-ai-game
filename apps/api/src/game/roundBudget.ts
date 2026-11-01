/** Splits an investor's budget evenly across the rounds left in the game. */
export function budgetPerRound(budget: number, roundsLeft: number): number {
  return Math.floor(budget / roundsLeft);
}

/** True when the investor can still afford the minimum ticket. */
export function canInvest(balance: number, minTicket: number): boolean {
  return balance > minTicket;
}
