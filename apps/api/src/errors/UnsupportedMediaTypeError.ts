import { ErrorCode } from '@inverstorm/shared';
import { AppError } from './AppError.js';

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Content-Type must be application/json') {
    super(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, message);
  }
}
