import { z } from 'zod';

const CheckStatus = z.enum(['ok', 'error']);

export const HealthDtoSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    uptime: z.number().nonnegative(),
    checks: z
      .object({
        database: CheckStatus,
        /** Reachability of the active thinking LLM; never affects the HTTP status. */
        thinking: CheckStatus,
        /** Reachability of the active decision LLM; never affects the HTTP status. */
        decision: CheckStatus,
      })
      .strict(),
  })
  .strict();

export type HealthDto = z.infer<typeof HealthDtoSchema>;
