import type { DecisionAnswer } from '@investor/shared';
import type { ConfidenceGate } from '../llm/decision/ConfidenceGate.js';
import { ProviderBadResponseError } from '../llm/errors/ProviderBadResponseError.js';

/** One judgment from the decision model, with the confidence gate's verdict. Never changed by the brain. */
export interface Judged<T> {
  /** A choice label, an expected score level (0 = lowest) or a noul's probability of yes. */
  value: T;
  confidence: number;
  /** True when `confidence` is below `llm.decision.minConfidence`. */
  uncertain: boolean;
}

type Answers = Readonly<Record<string, DecisionAnswer>>;

/** A choice answer narrowed to the question's labels. A label outside them is a bad provider response. */
export function judgeChoice<L extends string>(
  answers: Answers,
  name: string,
  labels: readonly L[],
  gate: ConfidenceGate,
): Judged<L> {
  const answer = answerOf(answers, name, 'choice');
  if (!(labels as readonly string[]).includes(answer.value)) {
    throw new ProviderBadResponseError(`Decision answer "${name}" chose unknown label "${answer.value}"`);
  }
  return { value: answer.value as L, ...gate.assess(answer) };
}

/** A score answer: the expected level, from 0 (lowest). */
export function judgeScore(answers: Answers, name: string, gate: ConfidenceGate): Judged<number> {
  const answer = answerOf(answers, name, 'score');
  return { value: answer.value, ...gate.assess(answer) };
}

/** A noul answer: the probability of yes. */
export function judgeNoul(answers: Answers, name: string, gate: ConfidenceGate): Judged<number> {
  const answer = answerOf(answers, name, 'noul');
  return { value: answer.probability, ...gate.assess(answer) };
}

function answerOf<T extends DecisionAnswer['type']>(
  answers: Answers,
  name: string,
  type: T,
): Extract<DecisionAnswer, { type: T }> {
  const answer = answers[name];
  if (answer?.type !== type) {
    throw new ProviderBadResponseError(`Decision answer "${name}" is missing or not a ${type}`);
  }
  return answer as Extract<DecisionAnswer, { type: T }>;
}
