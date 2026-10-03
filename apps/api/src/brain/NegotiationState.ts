import type { GamePhase } from '@investor/shared';
import type { PlayerIntent } from './PlayerIntent.js';

/**
 * The state the decision model judges, in the tutor's snake_case shape. It holds the investor's hidden
 * numbers, so it goes to the decision provider only: it is never logged, stored or returned. A type alias
 * (not an interface) so it is assignable to the provider's `Record<string, unknown>` state.
 */
export type NegotiationState = {
  phase: GamePhase;
  turn: number;
  turns_left: number;
  startup: {
    name: string;
    sector: string;
    pitch: string;
    valuation_ask: number;
    ask_amount: number;
  };
  player_offer?: {
    investment: number;
    equity: number;
    /** Post-money valuation of the player's offer. */
    implied_valuation: number;
    within_budget: boolean;
    meets_min_equity: boolean;
  };
  player_message?: string;
  player_intent?: PlayerIntent;
  investor: {
    personality: string;
    goals: string[];
    budget: number;
    min_equity: number;
    max_equity: number;
    interest: number;
    patience: number;
    current_offer?: { investment: number; equity: number };
  };
  /** Earlier offers as short lines, oldest first. */
  history: string[];
};
