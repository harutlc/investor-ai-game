import { z } from 'zod';

export const HealthDtoSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    uptime: z.number().nonnegative(),
    checks: z.object({
      database: z.enum(['ok', 'error']),
    }),
  })
  .strict();

export type HealthDto = z.infer<typeof HealthDtoSchema>;
