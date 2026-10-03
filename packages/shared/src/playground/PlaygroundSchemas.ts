import { z } from 'zod';
import { DecisionQuestionsSchema, DecisionStateSchema } from '../decision/DecisionSchemas.js';

export const ChatMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(4000),
  })
  .strict();

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

const conversation = {
  system: z.string().min(1).max(8000).optional(),
  messages: z
    .array(ChatMessageSchema)
    .min(1)
    .max(20)
    .refine((messages) => messages[0]?.role === 'user', { error: 'the first message must be from the user' }),
};

export const PlaygroundTextRequestSchema = z.object(conversation).strict();
export type PlaygroundTextRequest = z.infer<typeof PlaygroundTextRequestSchema>;

export const PlaygroundJsonRequestSchema = z
  .object({
    ...conversation,
    /** A JSON Schema describing the expected output. */
    schema: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PlaygroundJsonRequest = z.infer<typeof PlaygroundJsonRequestSchema>;

export const PlaygroundDecisionRequestSchema = z
  .object({
    state: DecisionStateSchema,
    questions: DecisionQuestionsSchema,
  })
  .strict();
export type PlaygroundDecisionRequest = z.infer<typeof PlaygroundDecisionRequestSchema>;

export const PlaygroundTextResponseSchema = z.object({
  provider: z.string(),
  model: z.string(),
  text: z.string(),
  latencyMs: z.number().nonnegative(),
});
export type PlaygroundTextResponse = z.infer<typeof PlaygroundTextResponseSchema>;

export const PlaygroundJsonResponseSchema = z.object({
  provider: z.string(),
  model: z.string(),
  data: z.unknown(),
  latencyMs: z.number().nonnegative(),
});
export type PlaygroundJsonResponse = z.infer<typeof PlaygroundJsonResponseSchema>;
