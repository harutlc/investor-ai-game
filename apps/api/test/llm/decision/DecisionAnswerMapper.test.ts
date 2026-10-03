import { describe, expect, it } from 'vitest';
import { DecisionAnswerMapper } from '../../../src/llm/decision/DecisionAnswerMapper.js';
import { ProviderBadResponseError } from '../../../src/llm/errors/ProviderBadResponseError.js';
import { tutorQuestions, tutorWireAnswers } from './fixtures.js';

describe('DecisionAnswerMapper', () => {
  it('normalizes each primitive and drops provider-specific fields', () => {
    expect(DecisionAnswerMapper.map(tutorQuestions, tutorWireAnswers)).toEqual({
      accept: {
        type: 'score',
        value: 1.2,
        confidence: 0.61,
        probabilities: { '0': 0.2, '1': 0.5, '2': 0.2, '3': 0.07, '4': 0.03 },
      },
      reaction: {
        type: 'choice',
        value: 'counter',
        confidence: 0.8,
        probabilities: { accept: 0.02, counter: 0.9, reject: 0.06, walk_away: 0.02 },
      },
      good_deal: { type: 'noul', probability: 0.31 },
    });
  });

  it.each([
    ['a missing answer', { ...tutorWireAnswers, good_deal: undefined }],
    [
      'a type mismatch',
      { ...tutorWireAnswers, good_deal: { type: 'score', score: 1, confidence: 1, probabilities: {} } },
    ],
    [
      'an unknown label',
      { ...tutorWireAnswers, reaction: { ...tutorWireAnswers.reaction, choice: 'invest_double' } },
    ],
    ['a probability above 1', { ...tutorWireAnswers, good_deal: { type: 'noul', noul: 1.4 } }],
    ['a score outside the levels', { ...tutorWireAnswers, accept: { ...tutorWireAnswers.accept, score: 7 } }],
  ])('rejects %s', (_label, answers) => {
    expect(() => DecisionAnswerMapper.map(tutorQuestions, answers)).toThrow(ProviderBadResponseError);
  });
});
