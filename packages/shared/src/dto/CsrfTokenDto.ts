import { z } from 'zod';

export const CsrfTokenDtoSchema = z
  .object({
    csrfToken: z.string().min(1),
  })
  .strict();

export type CsrfTokenDto = z.infer<typeof CsrfTokenDtoSchema>;
