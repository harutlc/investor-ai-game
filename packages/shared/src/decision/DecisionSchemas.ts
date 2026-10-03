import { z } from 'zod';

/** Text, a JSON object or a JSON array: the forms System One accepts for state, instructions and criteria. */
const Entry = z.union([z.string().min(1), z.record(z.string(), z.json()), z.array(z.json())]);

export const DecisionStateSchema = Entry;
export type DecisionState = z.infer<typeof DecisionStateSchema>;

export const MAX_CHOICE_OPTIONS = 100;
export const MAX_SCORE_LEVELS = 10;

export const ChoiceQuestionSchema = z
  .object({
    type: z.literal('choice'),
    instructions: Entry,
    /** Option labels mapped to an optional description. */
    criteria: z
      .record(z.string().min(1), Entry.nullable())
      .refine((criteria) => Object.keys(criteria).length >= 2, { error: 'needs at least 2 options' })
      .refine((criteria) => Object.keys(criteria).length <= MAX_CHOICE_OPTIONS, {
        error: `allows at most ${MAX_CHOICE_OPTIONS} options`,
      }),
  })
  .strict();

export const NoulQuestionSchema = z
  .object({
    type: z.literal('noul'),
    instructions: Entry,
    criteria: z.object({ true: Entry.optional(), false: Entry.optional() }).strict().optional(),
  })
  .strict();

export const ScoreQuestionSchema = z
  .object({
    type: z.literal('score'),
    instructions: Entry,
    /** Ordered level descriptions, lowest first. Every level must be described. */
    criteria: z.array(Entry).min(2).max(MAX_SCORE_LEVELS),
  })
  .strict();

export const DecisionQuestionSchema = z.discriminatedUnion('type', [
  ChoiceQuestionSchema,
  NoulQuestionSchema,
  ScoreQuestionSchema,
]);

export const DecisionQuestionsSchema = z
  .record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, { error: 'must be an identifier' }),
    DecisionQuestionSchema,
  )
  .refine((questions) => Object.keys(questions).length > 0, { error: 'needs at least one question' });

export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;
export type NoulQuestion = z.infer<typeof NoulQuestionSchema>;
export type ScoreQuestion = z.infer<typeof ScoreQuestionSchema>;
export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>;
export type DecisionQuestions = z.infer<typeof DecisionQuestionsSchema>;

const Probability = z.number().min(0).max(1);

export const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  value: z.string(),
  confidence: Probability,
  probabilities: z.record(z.string(), Probability),
});

export const NoulAnswerSchema = z.object({
  type: z.literal('noul'),
  /** Probability that the answer is yes. */
  probability: Probability,
});

export const ScoreAnswerSchema = z.object({
  type: z.literal('score'),
  /** Expected (probability-weighted) level, may fall between levels. */
  value: z.number(),
  confidence: Probability,
  /** Probabilities keyed by level index ("0", "1", ...). */
  probabilities: z.record(z.string(), Probability),
});

export const DecisionAnswerSchema = z.discriminatedUnion('type', [
  ChoiceAnswerSchema,
  NoulAnswerSchema,
  ScoreAnswerSchema,
]);

export type ChoiceAnswer<L extends string = string> = Omit<z.infer<typeof ChoiceAnswerSchema>, 'value'> & {
  value: L;
};
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;

export const DecisionResultDtoSchema = z.object({
  provider: z.string(),
  model: z.string(),
  answers: z.record(z.string(), DecisionAnswerSchema),
  usage: z.object({ inputTokens: z.number().int().nonnegative() }),
  latencyMs: z.number().nonnegative(),
});

export type DecisionResultDto = z.infer<typeof DecisionResultDtoSchema>;
