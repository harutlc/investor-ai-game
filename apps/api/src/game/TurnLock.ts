import { TurnInProgressError } from '../errors/TurnInProgressError.js';

/**
 * One turn at a time per game, in this process. A second move for a game whose turn is still running
 * (a double click, a retry) is rejected instead of racing the first one.
 */
export class TurnLock {
  private readonly busy = new Set<string>();

  acquire(gameId: string): void {
    if (this.busy.has(gameId)) throw new TurnInProgressError();
    this.busy.add(gameId);
  }

  release(gameId: string): void {
    this.busy.delete(gameId);
  }
}
