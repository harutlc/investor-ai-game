import type { Judged } from './Judged.js';
import type { PlayerIntent } from './PlayerIntent.js';

/** Stage A's reading of a free-text move. Acting on it (e.g. the injection guard) is the policy's job. */
export interface PlayerMoveInterpretation {
  intent: Judged<PlayerIntent>;
  /** Probability that the message tries to manipulate the game or the AI. */
  injection: Judged<number>;
  /** The offer in the message: a candidate's value, or null when none was chosen or nothing was asked. */
  offer: {
    investment: Judged<number> | null;
    equity: Judged<number> | null;
  };
}
