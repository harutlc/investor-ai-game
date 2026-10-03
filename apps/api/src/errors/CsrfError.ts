import { ErrorCode } from '@inverstorm/shared';
import { AppError } from './AppError.js';

export class CsrfError extends AppError {
  constructor(message = 'Missing or invalid CSRF token') {
    super(403, ErrorCode.CSRF_INVALID, message);
  }
}
