import type { InvestorMeters } from '@investor/shared';
import type { InvestorState } from './InvestorState.js';

/** Interest below this is `low`; below HIGH_FROM it is `medium`. Wording, not tuning, so not in config. */
const MEDIUM_FROM = 0.35;
const HIGH_FROM = 0.65;

/** Indexed by remaining patience; 4 or more uses the last phrase. */
const PATIENCE_HINTS = [
  'Out of patience',
  'Checking the time',
  'Tapping the table',
  'Getting restless',
  'Listening patiently',
] as const;

/** Turns the investor's hidden meters into the hints the player sees. Never exposes a number. */
export class MeterHintMapper {
  toMeters(state: Pick<InvestorState, 'interest' | 'patience'>): InvestorMeters {
    const interestLevel =
      state.interest >= HIGH_FROM ? 'high' : state.interest >= MEDIUM_FROM ? 'medium' : 'low';
    const patienceHint = PATIENCE_HINTS[Math.min(Math.max(state.patience, 0), PATIENCE_HINTS.length - 1)]!;
    return { interestLevel, patienceHint };
  }
}
