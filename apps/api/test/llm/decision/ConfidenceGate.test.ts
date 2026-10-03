import type { DecisionAnswer } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { ConfidenceGate } from '../../../src/llm/decision/ConfidenceGate.js';

const gate = new ConfidenceGate(0.55);

const choice = (confidence: number): DecisionAnswer => ({
  type: 'choice',
  value: 'counter',
  confidence,
  probabilities: { counter: confidence, reject: 1 - confidence },
});
const noul = (probability: number): DecisionAnswer => ({ type: 'noul', probability });
const score = (confidence: number): DecisionAnswer => ({
  type: 'score',
  value: 2.4,
  confidence,
  probabilities: { '0': 0.1, '1': 0.2, '2': confidence, '3': 0.7 - confidence },
});

describe('ConfidenceGate', () => {
  it('marks a low-confidence choice uncertain without changing it', () => {
    const answer = choice(0.41);
    const before = structuredClone(answer);
    expect(gate.assess(answer)).toEqual({ uncertain: true, confidence: 0.41 });
    expect(answer).toEqual(before);
  });

  it('treats a confident "no" as certain', () => {
    expect(gate.assess(noul(0.2))).toEqual({ uncertain: false, confidence: 0.8 });
  });

  it('treats a coin-flip noul as uncertain', () => {
    expect(gate.assess(noul(0.5)).uncertain).toBe(true);
  });

  it('counts a confidence exactly at the threshold as certain', () => {
    expect(gate.assess(score(0.55)).uncertain).toBe(false);
  });

  it('assesses every answer by key', () => {
    expect(gate.assessAll({ reaction: choice(0.9), good_deal: noul(0.52) })).toEqual({
      reaction: { uncertain: false, confidence: 0.9 },
      good_deal: { uncertain: true, confidence: 0.52 },
    });
  });
});
