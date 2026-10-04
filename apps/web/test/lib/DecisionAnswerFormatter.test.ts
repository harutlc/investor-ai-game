import { describe, expect, it } from 'vitest';
import { DecisionAnswerFormatter } from '@/lib/DecisionAnswerFormatter';
import { INSIGHTS } from '../support/fixtures';

describe('DecisionAnswerFormatter', () => {
  const [stageB, failed] = INSIGHTS.entries;

  it('formats choice, score and noul answers', () => {
    expect(DecisionAnswerFormatter.rows(stageB!)).toEqual([
      { name: 'accept', type: 'score', display: 'Probably reject · 1.1', confidence: 0.82, uncertain: false },
      { name: 'reaction', type: 'choice', display: 'counter', confidence: 0.49, uncertain: true },
      { name: 'good_deal', type: 'noul', display: 'p = 0.31', confidence: 0.69, uncertain: false },
    ]);
  });

  it('falls back to the level number without a criteria label', () => {
    const row = DecisionAnswerFormatter.row(
      'confidence',
      { type: 'score', value: 2.6, confidence: 0.6, probabilities: {} },
      undefined,
    );
    expect(row.display).toBe('level 3 · 2.6');
  });

  it('marks a near-even noul as uncertain', () => {
    expect(
      DecisionAnswerFormatter.row('insult', { type: 'noul', probability: 0.5 }, undefined).uncertain,
    ).toBe(true);
  });

  it('has no rows for a failed entry and describes the call', () => {
    expect(DecisionAnswerFormatter.rows(failed!)).toEqual([]);
    expect(DecisionAnswerFormatter.stageLabel('A')).toBe('Stage A');
    expect(DecisionAnswerFormatter.meta(stageB!)).toBe('laya · english · 412 ms');
    expect(DecisionAnswerFormatter.meta(failed!)).toBe('laya · 10000 ms');
  });
});
