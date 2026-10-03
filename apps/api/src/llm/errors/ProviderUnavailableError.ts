import { ErrorCode } from '@inverstorm/shared';
import { AppError } from '../../errors/AppError.js';

/** The backend could not be reached or did not answer in time (connection, timeout, 429/529, 5xx, auth). */
export class ProviderUnavailableError extends AppError {
  constructor(message = 'The AI provider is unavailable, please try again later', options?: ErrorOptions) {
    super(503, ErrorCode.PROVIDER_UNAVAILABLE, message);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
