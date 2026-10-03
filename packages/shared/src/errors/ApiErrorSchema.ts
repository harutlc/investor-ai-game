import { z } from 'zod';
import { ErrorCodeSchema } from './ErrorCode.js';

/** `{ error: { code, message, details?, requestId } }`, the shape of every API error response. */
export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string(),
        details: z.unknown().optional(),
        requestId: z.string(),
      })
      .strict(),
  })
  .strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;
