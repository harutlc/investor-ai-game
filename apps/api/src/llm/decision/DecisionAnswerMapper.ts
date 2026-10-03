import type { DecisionAnswer } from '@investor/shared';
import { z } from 'zod';
import { ProviderBadResponseError } from '../errors/ProviderBadResponseError.js';
import type { QuestionSet } from './DecisionProvider.js';

const probability = z.number().min(0).max(1);

/** The System One wire shapes shared by Jev and Laya (extra provider fields are ignored). */
const WireAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
  z.object({ type: z.literal('noul'), noul: probability }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
]);

/** Converts raw System One answers into provider-neutral answers, rejecting anything inconsistent. */
export class DecisionAnswerMapper {
  static map(questions: QuestionSet, rawAnswers: unknown): Record<string, DecisionAnswer> {
    const answers = (rawAnswers ?? {}) as Record<string, unknown>;
    const mapped: Record<string, DecisionAnswer> = {};

    for (const [name, question] of Object.entries(questions)) {
      const parsed = WireAnswerSchema.safeParse(answers[name]);
      if (!parsed.success) throw DecisionAnswerMapper.bad(`answer "${name}" is missing or malformed`);
      const wire = parsed.data;
      if (wire.type !== question.type) {
        throw DecisionAnswerMapper.bad(`answer "${name}" is a ${wire.type}, expected ${question.type}`);
      }

      switch (wire.type) {
        case 'choice': {
          const labels = Object.keys((question as { criteria: object }).criteria);
          if (!labels.includes(wire.choice)) {
            throw DecisionAnswerMapper.bad(`answer "${name}" chose unknown label "${wire.choice}"`);
          }
          mapped[name] = {
            type: 'choice',
            value: wire.choice,
            confidence: wire.confidence,
            probabilities: wire.probabilities,
          };
          break;
        }
        case 'noul':
          mapped[name] = { type: 'noul', probability: wire.noul };
          break;
        case 'score': {
          const maxLevel = (question as { criteria: readonly unknown[] }).criteria.length - 1;
          if (wire.score < 0 || wire.score > maxLevel) {
            throw DecisionAnswerMapper.bad(`answer "${name}" score ${wire.score} is outside 0..${maxLevel}`);
          }
          mapped[name] = {
            type: 'score',
            value: wire.score,
            confidence: wire.confidence,
            probabilities: wire.probabilities,
          };
          break;
        }
      }
    }
    return mapped;
  }

  private static bad(detail: string): ProviderBadResponseError {
    return new ProviderBadResponseError('The decision provider returned an inconsistent answer', {
      cause: new Error(detail),
    });
  }
}
