import { z } from 'zod';

/** Stable, machine-readable error codes returned in the API error envelope. */
export const ErrorCodeSchema = z.enum([
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'CSRF_INVALID',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_BAD_RESPONSE',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorCode = ErrorCodeSchema.enum;
