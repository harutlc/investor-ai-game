import { ErrorCode } from '@inverstorm/shared';
import { AppError } from './AppError.js';

export class InvalidJsonError extends AppError {
  constructor(message = 'Request body is not valid JSON') {
    super(400, ErrorCode.INVALID_JSON, message);
  }
}
