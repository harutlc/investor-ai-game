import { EquityPercentSchema, InvestorPersonaDtoSchema, MoneySchema } from '@investor/shared';
import { z } from 'zod';

/** The hidden numbers code negotiates with. Never sent to players. */
export const PersonaNumbersSchema = z
  .object({
    budget: MoneySchema,
    minEquity: EquityPercentSchema,
    maxEquity: EquityPercentSchema,
    initialInterest: z.number().min(0).max(1),
    patience: z.number().int().min(1),
    /** Equity points the investor moves per unit of concession. */
    concessionStep: z.number().gt(0).lt(100),
  })
  .strict()
  .refine((numbers) => numbers.minEquity <= numbers.maxEquity, {
    error: 'must not exceed maxEquity',
    path: ['minEquity'],
  });

/**
 * A full persona definition (API-only): the public profile plus what the brain, the voice and the game
 * master need. Only the public profile ever leaves the server.
 */
export const PersonaDefinitionSchema = InvestorPersonaDtoSchema.extend({
  /** Given to the decision model as part of the state. */
  personality: z.string().min(1).max(500),
  goals: z.array(z.string().min(1).max(200)).min(1).max(6),
  /** Given to the thinking model: how the investor talks. */
  toneInstructions: z.string().min(1).max(1000),
  numbers: PersonaNumbersSchema,
}).strict();

export type PersonaNumbers = z.infer<typeof PersonaNumbersSchema>;
export type PersonaDefinition = z.infer<typeof PersonaDefinitionSchema>;
