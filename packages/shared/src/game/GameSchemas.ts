import { z } from 'zod';
import { EquityPercentSchema, MoneySchema } from './Money.js';
import { ValuationCalculator } from './ValuationCalculator.js';

export const OfferSideSchema = z.enum(['player', 'investor']);

/** An "€X for Y%" offer. `impliedValuation` is the post-money valuation and must match the math. */
export const OfferSchema = z
  .object({
    investment: MoneySchema,
    equity: EquityPercentSchema,
    impliedValuation: MoneySchema,
    from: OfferSideSchema,
    turn: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((offer, ctx) => {
    let expected: number;
    try {
      expected = ValuationCalculator.impliedPostMoney(offer.investment, offer.equity);
    } catch {
      return; // investment / equity already reported by their own schemas
    }
    if (offer.impliedValuation !== expected) {
      ctx.addIssue({
        code: 'custom',
        message: `must equal the post-money valuation ${expected}`,
        path: ['impliedValuation'],
      });
    }
  });

/** The founder's pitch. `valuation` is the asked pre-money valuation. */
export const StartupPitchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sector: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(2000),
    valuation: MoneySchema,
    askAmount: MoneySchema,
  })
  .strict();

export const ChatRoleSchema = z.enum(['player', 'investor', 'system', 'event']);

export const ChatMessageSchema = z
  .object({
    id: z.uuid(),
    role: ChatRoleSchema,
    text: z.string().min(1).max(4000),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const PlayerOptionKindSchema = z.enum([
  'counter',
  'accept',
  'decline',
  'message',
  'answer',
  'leverage',
]);

/** A reply option generated for the player. Counter options always carry the offer they propose. */
export const PlayerOptionSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: PlayerOptionKindSchema,
    label: z.string().min(1).max(120),
    offer: OfferSchema.optional(),
  })
  .strict()
  .refine((option) => option.kind !== 'counter' || option.offer !== undefined, {
    error: 'is required for a counter option',
    path: ['offer'],
  });

export const GameStatusSchema = z.enum([
  'negotiating',
  'deal',
  'walked_away',
  'rejected_by_player',
  'out_of_turns',
]);

export const GamePhaseSchema = z.enum(['pitch', 'due_diligence', 'term_negotiation', 'closing', 'finished']);

/** What the player may see of the investor's inner state: hints, never numbers. */
export const InvestorMetersSchema = z
  .object({
    interestLevel: z.enum(['low', 'medium', 'high']),
    patienceHint: z.string().min(1).max(120),
    trustHint: z.string().min(1).max(120).optional(),
  })
  .strict();

export type OfferSide = z.infer<typeof OfferSideSchema>;
export type Offer = z.infer<typeof OfferSchema>;
export type StartupPitch = z.infer<typeof StartupPitchSchema>;
export type ChatRole = z.infer<typeof ChatRoleSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type PlayerOptionKind = z.infer<typeof PlayerOptionKindSchema>;
export type PlayerOption = z.infer<typeof PlayerOptionSchema>;
export type GameStatus = z.infer<typeof GameStatusSchema>;
export type GamePhase = z.infer<typeof GamePhaseSchema>;
export type InvestorMeters = z.infer<typeof InvestorMetersSchema>;
