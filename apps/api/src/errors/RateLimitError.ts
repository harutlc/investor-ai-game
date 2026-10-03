import { ErrorCode } from '@inverstorm/shared';
import { AppError } from './AppError.js';

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(429, ErrorCode.RATE_LIMITED, message);
  }
}
