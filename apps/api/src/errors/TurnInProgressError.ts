import { ErrorCode } from '@investor/shared';
import { AppError } from './AppError.js';

/** Another move for the same game is still being processed. */
export class TurnInProgressError extends AppError {
  constructor() {
    super(409, ErrorCode.TURN_IN_PROGRESS, 'The previous move is still being processed');
  }
}
