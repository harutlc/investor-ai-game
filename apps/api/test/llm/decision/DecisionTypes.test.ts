import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDecisionRequest, type DecisionResult } from '../../../src/llm/decision/DecisionProvider.js';
import { ValidationError } from '../../../src/errors/ValidationError.js';
import { tutorQuestions, tutorState } from './fixtures.js';

const choice = (n: number) => ({
  type: 'choice' as const,
  instructions: 'pick',
  criteria: Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, null])),
});
const score = (n: number) => ({
  type: 'score' as const,
  instructions: 's',
  criteria: Array<string>(n).fill('level'),
});

function issuesOf(fn: () => void): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValidationError) return (error.details as { path: string }[]).map((d) => d.path);
    throw error;
  }
  return [];
}

describe('validateDecisionRequest', () => {
  it('accepts the tutor question set', () => {
    expect(() => validateDecisionRequest({ state: tutorState, questions: tutorQuestions })).not.toThrow();
  });

  it.each([
    ['150 options', { q: choice(150) }],
    ['1 option', { q: choice(1) }],
    ['1 score level', { q: score(1) }],
    ['11 score levels', { q: score(11) }],
    ['no questions', {}],
  ])('rejects %s', (_label, questions) => {
    expect(issuesOf(() => validateDecisionRequest({ state: 'x', questions }))[0]).toMatch(/^questions/);
  });

  it('rejects an empty state', () => {
    expect(issuesOf(() => validateDecisionRequest({ state: '', questions: { q: choice(2) } }))).toContain(
      'state',
    );
  });
});

describe('DecisionResult typing', () => {
  it('types choice answers as the label union', () => {
    type Result = DecisionResult<typeof tutorQuestions>;
    expectTypeOf<Result['answers']['reaction']['value']>().toEqualTypeOf<
      'accept' | 'counter' | 'reject' | 'walk_away'
    >();
    expectTypeOf<Result['answers']['good_deal']['probability']>().toEqualTypeOf<number>();
    expectTypeOf<Result['answers']['accept']['value']>().toEqualTypeOf<number>();
  });
});
