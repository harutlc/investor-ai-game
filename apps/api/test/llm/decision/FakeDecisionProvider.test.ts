import { describe, expect, it } from 'vitest';
import { FakeDecisionProvider } from '../../../src/llm/decision/FakeDecisionProvider.js';
import { ProviderUnavailableError } from '../../../src/llm/errors/ProviderUnavailableError.js';
import { tutorQuestions, tutorState } from './fixtures.js';

describe('FakeDecisionProvider', () => {
  it('answers deterministically by default', async () => {
    const result = await new FakeDecisionProvider().decide({ state: tutorState, questions: tutorQuestions });
    expect(result.provider).toBe('fake');
    expect(result.answers.reaction).toMatchObject({ type: 'choice', value: 'accept', confidence: 1 });
    expect(result.answers.reaction.probabilities.counter).toBeCloseTo(0.25);
    expect(result.answers.good_deal).toEqual({ type: 'noul', probability: 0.5 });
    expect(result.answers.accept).toMatchObject({ type: 'score', value: 2 });
  });

  it('merges scripted answers over the defaults', async () => {
    const fake = new FakeDecisionProvider([
      { reaction: { type: 'choice', value: 'counter', confidence: 0.9, probabilities: {} } },
    ]);
    const result = await fake.decide({ state: tutorState, questions: tutorQuestions });
    expect(result.answers.reaction.value).toBe('counter');
    expect(result.answers.good_deal.probability).toBe(0.5);
  });

  it('runs decideMany in order and throws scripted errors', async () => {
    const fake = new FakeDecisionProvider();
    const results = await fake.decideMany([
      { state: 'a', questions: { q: { type: 'noul', instructions: 'yes?' } } },
      {
        state: 'b',
        questions: { r: { type: 'choice', instructions: 'which?', criteria: { x: null, y: null } } },
      },
    ]);
    expect(results.map((r) => Object.keys(r.answers)[0])).toEqual(['q', 'r']);
    fake.enqueue(new ProviderUnavailableError());
    await expect(fake.decide({ state: 'c', questions: tutorQuestions })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it('validates requests and reports health', async () => {
    const fake = new FakeDecisionProvider();
    await expect(fake.decide({ state: 'x', questions: {} })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(fake.setHealthy(false).ping()).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
