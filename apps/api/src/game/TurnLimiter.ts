import type { GameStatus } from '@investor/shared';
import type { InvestorAction } from './InvestorAction.js';

/** What the player's move means for the end of the game; the engine maps options and Stage A intents to it. */
export type PlayerMoveKind = 'accept' | 'decline' | 'other';

export interface TurnEndInput {
  playerMove: PlayerMoveKind;
  /** Absent when the player accepted or declined, since the investor is not evaluated then. */
  action?: InvestorAction;
  /** The turn this move used, counting from 1. */
  turn: number;
}

/** The game's end conditions (TASKS §10.8): who ended it, or whether the turn limit did. */
export class TurnLimiter {
  constructor(readonly maxTurns: number) {}

  statusAfter({ playerMove, action, turn }: TurnEndInput): GameStatus {
    if (playerMove === 'accept') return 'deal';
    if (playerMove === 'decline') return 'rejected_by_player';
    if (action?.kind === 'accept') return 'deal';
    if (action?.kind === 'walk_away') return 'walked_away';
    return turn >= this.maxTurns ? 'out_of_turns' : 'negotiating';
  }

  turnsLeft(turn: number): number {
    return Math.max(0, this.maxTurns - turn);
  }
}
