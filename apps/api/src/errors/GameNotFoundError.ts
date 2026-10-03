import { ErrorCode } from '@investor/shared';
import { AppError } from './AppError.js';

/** The game does not exist, or belongs to another player; both look the same on purpose. */
export class GameNotFoundError extends AppError {
  constructor() {
    super(404, ErrorCode.NOT_FOUND, 'Game not found');
  }
}
