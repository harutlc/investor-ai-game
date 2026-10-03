import { ErrorCode } from '@inverstorm/shared';
import { AppError } from './AppError.js';

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Request body is too large') {
    super(413, ErrorCode.PAYLOAD_TOO_LARGE, message);
  }
}
