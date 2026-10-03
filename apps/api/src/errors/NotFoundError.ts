import { ErrorCode } from '@investor/shared';
import { AppError } from './AppError.js';

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, ErrorCode.NOT_FOUND, message);
  }
}
