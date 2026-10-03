import { ErrorCode } from '@investor/shared';
import { AppError } from './AppError.js';

/** A well-formed move that does not fit the game, e.g. an option id that is not on offer. */
export class InvalidMoveError extends AppError {
  constructor(message = 'That move is not possible right now') {
    super(422, ErrorCode.INVALID_MOVE, message);
  }
}
