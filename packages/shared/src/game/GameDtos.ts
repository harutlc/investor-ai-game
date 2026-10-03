import { z } from 'zod';
import { DecisionAnswerSchema, DecisionQuestionsSchema } from '../decision/DecisionSchemas.js';
import {
  ChatMessageSchema,
  GamePhaseSchema,
  GameStatusSchema,
  InvestorMetersSchema,
  OfferSchema,
  PlayerOptionSchema,
  StartupPitchSchema,
} from './GameSchemas.js';
import { EquityPercentSchema, MoneySchema } from './Money.js';

// Every schema here is returned to (or sent by) players, so all of them are strict: a hidden investor
// number added by mistake fails validation instead of reaching the client.

export const PersonaIdSchema = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
  error: 'must be a kebab-case persona id',
});

/** The public face of an investor persona. Never carries hidden numbers, brain or voice instructions. */
export const InvestorPersonaDtoSchema = z
  .object({
    id: PersonaIdSchema,
    name: z.string().min(1).max(60),
    avatar: z.string().min(1).max(8),
    tagline: z.string().min(1).max(160),
    traits: z.array(z.string().min(1).max(30)).min(1).max(4),
  })
  .strict();

export const PersonaListDtoSchema = z.object({ personas: z.array(InvestorPersonaDtoSchema) }).strict();

/** The public state of a game session. */
export const GameSessionDtoSchema = z
  .object({
    id: z.uuid(),
    persona: InvestorPersonaDtoSchema,
    pitch: StartupPitchSchema,
    status: GameStatusSchema,
    phase: GamePhaseSchema,
    turn: z.number().int().nonnegative(),
    maxTurns: z.number().int().positive(),
    currentInvestorOffer: OfferSchema.nullable(),
    lastPlayerOffer: OfferSchema.nullable(),
    meters: InvestorMetersSchema,
    messages: z.array(ChatMessageSchema),
    options: z.array(PlayerOptionSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

/** One of a player's games, for the game list: no transcript, no options, no hidden numbers. */
export const GameSummaryDtoSchema = z
  .object({
    id: z.uuid(),
    persona: InvestorPersonaDtoSchema,
    startupName: z.string().min(1).max(80),
    status: GameStatusSchema,
    turn: z.number().int().nonnegative(),
    maxTurns: z.number().int().positive(),
    currentInvestorOffer: OfferSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const GameListDtoSchema = z.object({ games: z.array(GameSummaryDtoSchema) }).strict();

/** The result of one played turn: the updated session plus the messages this turn added. */
export const TurnResultDtoSchema = z
  .object({
    session: GameSessionDtoSchema,
    newMessages: z.array(ChatMessageSchema),
  })
  .strict();

export const DecisionStageSchema = z.enum(['A', 'B', 'debrief']);

/** One logged decision call, for the brain-insights panel. */
export const DecisionLogEntryDtoSchema = z
  .object({
    turn: z.number().int().nonnegative(),
    stage: DecisionStageSchema,
    provider: z.string().min(1),
    model: z.string().nullable(),
    questions: DecisionQuestionsSchema,
    answers: z.record(z.string(), DecisionAnswerSchema).nullable(),
    errorCode: z.string().nullable(),
    latencyMs: z.number().nonnegative(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const DecisionInsightsDtoSchema = z.object({ entries: z.array(DecisionLogEntryDtoSchema) }).strict();

export const CreateGameRequestSchema = z
  .object({
    personaId: PersonaIdSchema,
    pitch: StartupPitchSchema,
  })
  .strict();

/** A structured offer from the player; the server computes the implied valuation. */
export const OfferInputSchema = z
  .object({
    investment: MoneySchema,
    equity: EquityPercentSchema,
  })
  .strict();

/** Exactly one of: a generated option, a structured offer, or free text. */
export const PlayTurnRequestSchema = z
  .object({
    optionId: z.string().min(1).max(64).optional(),
    offer: OfferInputSchema.optional(),
    message: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine(
    (request) =>
      [request.optionId, request.offer, request.message].filter((input) => input !== undefined).length === 1,
    { error: 'must contain exactly one of optionId, offer or message' },
  );

export type InvestorPersonaDto = z.infer<typeof InvestorPersonaDtoSchema>;
export type PersonaListDto = z.infer<typeof PersonaListDtoSchema>;
export type GameSessionDto = z.infer<typeof GameSessionDtoSchema>;
export type GameSummaryDto = z.infer<typeof GameSummaryDtoSchema>;
export type GameListDto = z.infer<typeof GameListDtoSchema>;
export type TurnResultDto = z.infer<typeof TurnResultDtoSchema>;
export type DecisionStage = z.infer<typeof DecisionStageSchema>;
export type DecisionLogEntryDto = z.infer<typeof DecisionLogEntryDtoSchema>;
export type DecisionInsightsDto = z.infer<typeof DecisionInsightsDtoSchema>;
export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;
export type OfferInput = z.infer<typeof OfferInputSchema>;
export type PlayTurnRequest = z.infer<typeof PlayTurnRequestSchema>;
