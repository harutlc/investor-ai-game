import { ErrorCode } from '@investor/shared';
import { AppError } from './AppError.js';

/** A move for a game that is no longer being negotiated. */
export class GameAlreadyFinishedError extends AppError {
  constructor() {
    super(409, ErrorCode.GAME_FINISHED, 'This game has already ended');
  }
}
