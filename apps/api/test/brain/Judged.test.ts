import type { DecisionAnswer } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { judgeChoice, judgeNoul, judgeScore } from '../../src/brain/Judged.js';
import { ConfidenceGate } from '../../src/llm/decision/ConfidenceGate.js';
import { ProviderBadResponseError } from '../../src/llm/errors/ProviderBadResponseError.js';

const gate = new ConfidenceGate(0.55);
const REACTIONS = ['accept', 'counter', 'reject', 'walk_away'] as const;

const answers: Record<string, DecisionAnswer> = {
  reaction: { type: 'choice', value: 'counter', confidence: 0.4, probabilities: { counter: 0.4 } },
  accept: { type: 'score', value: 1.2, confidence: 0.8, probabilities: { '1': 0.8 } },
  good_deal: { type: 'noul', probability: 0.5 },
  insult: { type: 'noul', probability: 0.1 },
};

describe('judged answers', () => {
  it('keeps an uncertain choice label unchanged', () => {
    expect(judgeChoice(answers, 'reaction', REACTIONS, gate)).toEqual({
      value: 'counter',
      confidence: 0.4,
      uncertain: true,
    });
  });

  it('reports a score as its expected level', () => {
    expect(judgeScore(answers, 'accept', gate)).toEqual({ value: 1.2, confidence: 0.8, uncertain: false });
  });

  it('gives a coin-flip noul confidence 0.5 and marks it uncertain', () => {
    expect(judgeNoul(answers, 'good_deal', gate)).toEqual({ value: 0.5, confidence: 0.5, uncertain: true });
  });

  it('treats a confident "no" as certain', () => {
    expect(judgeNoul(answers, 'insult', gate)).toEqual({ value: 0.1, confidence: 0.9, uncertain: false });
  });

  it('rejects a missing answer, a wrong type or an unknown label as a bad provider response', () => {
    expect(() => judgeNoul(answers, 'missing', gate)).toThrow(ProviderBadResponseError);
    expect(() => judgeScore(answers, 'good_deal', gate)).toThrow(ProviderBadResponseError);
    expect(() => judgeChoice(answers, 'reaction', ['accept', 'reject'] as const, gate)).toThrow(
      ProviderBadResponseError,
    );
  });
});
