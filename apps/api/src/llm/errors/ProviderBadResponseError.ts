import { ErrorCode } from '@investor/shared';
import { AppError } from '../../errors/AppError.js';

/** The backend answered, but not with something usable (invalid output after retry, refusal, 4xx). */
export class ProviderBadResponseError extends AppError {
  constructor(message = 'The AI provider returned an unusable response', options?: ErrorOptions) {
    super(502, ErrorCode.PROVIDER_BAD_RESPONSE, message);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
