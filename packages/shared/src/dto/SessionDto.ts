import { z } from 'zod';

export const SessionDtoSchema = z
  .object({
    playerId: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type SessionDto = z.infer<typeof SessionDtoSchema>;
