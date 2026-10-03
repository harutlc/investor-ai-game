import type { Player } from '../repositories/PlayerRepository.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by RequestIdMiddleware for every request. */
      requestId: string;
      /** Set by PlayerSessionMiddleware for every route mounted after it. */
      player?: Player;
    }
  }
}

export {};
