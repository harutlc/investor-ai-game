import { EquityPercentSchema, MoneySchema } from '@investor/shared';
import { z } from 'zod';

/**
 * The investor's hidden state, stored with each game session. API-only on purpose: nothing in
 * `@investor/shared` may import it, so it cannot end up in a public DTO.
 */
export const InvestorStateSchema = z
  .object({
    /** Hidden negotiation numbers, seeded from the persona. */
    budget: MoneySchema,
    minEquity: EquityPercentSchema,
    maxEquity: EquityPercentSchema,
    /** Equity points the investor moves per unit of concession. */
    concessionStep: z.number().gt(0).lt(100),
    /** Meters updated every turn. */
    interest: z.number().min(0).max(1),
    /** Remaining patience; 0 means the investor is out of patience. */
    patience: z.number().int().nonnegative(),
  })
  .strict()
  .refine((state) => state.minEquity <= state.maxEquity, {
    error: 'must not exceed maxEquity',
    path: ['minEquity'],
  });

export type InvestorState = z.infer<typeof InvestorStateSchema>;
