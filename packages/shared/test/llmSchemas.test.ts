import { describe, expect, it } from 'vitest';
import {
  DecisionQuestionsSchema,
  ErrorCode,
  HealthDtoSchema,
  PlaygroundDecisionRequestSchema,
  PlaygroundJsonRequestSchema,
  PlaygroundTextRequestSchema,
} from '../src/index.js';

const user = (content: string) => ({ role: 'user' as const, content });

describe('provider error codes', () => {
  it('includes the provider codes', () => {
    expect(ErrorCode.PROVIDER_UNAVAILABLE).toBe('PROVIDER_UNAVAILABLE');
    expect(ErrorCode.PROVIDER_BAD_RESPONSE).toBe('PROVIDER_BAD_RESPONSE');
  });
});

describe('HealthDtoSchema', () => {
  it('requires thinking and decision checks', () => {
    expect(
      HealthDtoSchema.safeParse({
        status: 'ok',
        uptime: 1,
        checks: { database: 'ok', thinking: 'error', decision: 'ok' },
      }).success,
    ).toBe(true);
    expect(HealthDtoSchema.safeParse({ status: 'ok', uptime: 1, checks: { database: 'ok' } }).success).toBe(
      false,
    );
  });
});

describe('PlaygroundTextRequestSchema', () => {
  it('accepts a short conversation', () => {
    expect(
      PlaygroundTextRequestSchema.safeParse({ system: 'Be brief', messages: [user('hi')] }).success,
    ).toBe(true);
  });

  it('rejects 21 messages', () => {
    const messages = Array.from({ length: 21 }, (_, i) => user(`m${i}`));
    expect(PlaygroundTextRequestSchema.safeParse({ messages }).success).toBe(false);
  });

  it('rejects a 4001-character message', () => {
    expect(PlaygroundTextRequestSchema.safeParse({ messages: [user('x'.repeat(4001))] }).success).toBe(false);
  });

  it('rejects empty messages and an assistant-first conversation', () => {
    expect(PlaygroundTextRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(
      PlaygroundTextRequestSchema.safeParse({ messages: [{ role: 'assistant', content: 'hi' }] }).success,
    ).toBe(false);
  });

  it('rejects an 8001-character system prompt', () => {
    expect(
      PlaygroundTextRequestSchema.safeParse({ system: 's'.repeat(8001), messages: [user('hi')] }).success,
    ).toBe(false);
  });
});

describe('PlaygroundJsonRequestSchema', () => {
  it('requires a schema object', () => {
    expect(PlaygroundJsonRequestSchema.safeParse({ messages: [user('hi')] }).success).toBe(false);
    expect(
      PlaygroundJsonRequestSchema.safeParse({ messages: [user('hi')], schema: { type: 'object' } }).success,
    ).toBe(true);
  });
});

describe('DecisionQuestionsSchema', () => {
  const choice = (n: number) => ({
    type: 'choice',
    instructions: 'pick',
    criteria: Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, null])),
  });

  it('accepts a mixed question set', () => {
    expect(
      DecisionQuestionsSchema.safeParse({
        reaction: choice(3),
        good_deal: { type: 'noul', instructions: 'Attractive offer?' },
        accept: { type: 'score', instructions: 'Accept?', criteria: ['no', 'maybe', 'yes'] },
      }).success,
    ).toBe(true);
  });

  it('rejects 150 options, 1 option, 1 or 11 score levels, and an empty set', () => {
    expect(DecisionQuestionsSchema.safeParse({ q: choice(150) }).success).toBe(false);
    expect(DecisionQuestionsSchema.safeParse({ q: choice(1) }).success).toBe(false);
    const score = (n: number) => ({ type: 'score', instructions: 's', criteria: Array(n).fill('level') });
    expect(DecisionQuestionsSchema.safeParse({ q: score(1) }).success).toBe(false);
    expect(DecisionQuestionsSchema.safeParse({ q: score(11) }).success).toBe(false);
    expect(DecisionQuestionsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects null score levels (Laya requires every level to be described)', () => {
    expect(
      DecisionQuestionsSchema.safeParse({ q: { type: 'score', instructions: 's', criteria: ['a', null] } })
        .success,
    ).toBe(false);
  });

  it('validates a playground decision request', () => {
    expect(
      PlaygroundDecisionRequestSchema.safeParse({ state: { offer: 15 }, questions: { r: choice(2) } })
        .success,
    ).toBe(true);
  });
});
