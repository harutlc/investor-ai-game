import type { DecisionAnswer } from '@investor/shared';

export interface ConfidenceAssessment {
  uncertain: boolean;
  /** The confidence that was compared with the threshold. */
  confidence: number;
}

/**
 * Flags decision answers whose confidence is below `llm.decision.minConfidence`, so the policy can ask a
 * clarifying question instead of acting. Choice and score answers use their own confidence. A noul has
 * none, so it uses the likelier outcome's probability: 0.2 is a confident "no", 0.5 a coin flip.
 * Answers are never modified.
 */
export class ConfidenceGate {
  constructor(readonly minConfidence: number) {}

  assess(answer: DecisionAnswer): ConfidenceAssessment {
    const confidence =
      answer.type === 'noul' ? Math.max(answer.probability, 1 - answer.probability) : answer.confidence;
    return { uncertain: confidence < this.minConfidence, confidence };
  }

  assessAll<K extends string>(answers: Readonly<Record<K, DecisionAnswer>>): Record<K, ConfidenceAssessment> {
    const result = {} as Record<K, ConfidenceAssessment>;
    for (const key of Object.keys(answers) as K[]) result[key] = this.assess(answers[key]);
    return result;
  }
}
