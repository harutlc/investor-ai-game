import { DecisionQuestionsSchema } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { OfferCandidateExtractor } from '../../src/brain/OfferCandidateExtractor.js';
import { DealDecisionQuestions } from '../../src/brain/questions/DealDecisionQuestions.js';
import { OfferExtractionQuestions } from '../../src/brain/questions/OfferExtractionQuestions.js';
import { PlayerConductQuestions } from '../../src/brain/questions/PlayerConductQuestions.js';
import { PlayerIntentQuestions } from '../../src/brain/questions/PlayerIntentQuestions.js';
import { ConfidenceGate } from '../../src/llm/decision/ConfidenceGate.js';
import { brainMove, choice, noul, score } from '../support/brainFixtures.js';

const gate = new ConfidenceGate(0.55);
const deal = new DealDecisionQuestions();
const conduct = new PlayerConductQuestions();

describe('DealDecisionQuestions', () => {
  it("asks the tutor's accept levels and reaction labels, plus good_deal and concession_size", () => {
    const { questions } = deal.prepare(brainMove(null, { investment: 500_000, equity: 15 }));
    expect(DecisionQuestionsSchema.safeParse(questions).success).toBe(true);
    expect(questions.accept).toMatchObject({
      type: 'score',
      criteria: ['Definitely reject', 'Probably reject', 'Uncertain', 'Probably accept', 'Definitely accept'],
    });
    expect(Object.keys((questions.reaction as { criteria: object }).criteria)).toEqual([
      'accept',
      'counter',
      'reject',
      'walk_away',
    ]);
    expect(questions.good_deal).toMatchObject({ type: 'noul' });
    expect(Object.keys((questions.concession_size as { criteria: object }).criteria)).toEqual([
      'none',
      'small',
      'medium',
      'large',
    ]);
  });

  it('interprets the deal answers', () => {
    const prepared = deal.prepare(brainMove(null, { investment: 500_000, equity: 15 }));
    const answers = {
      accept: score(1),
      reaction: choice('counter', 0.4),
      good_deal: noul(0.31),
      concession_size: choice('small'),
    };
    expect(prepared.interpret(answers, gate)).toEqual({
      deal: {
        accept: { value: 1, confidence: 0.9, uncertain: false },
        reaction: { value: 'counter', confidence: 0.4, uncertain: true },
        goodDeal: { value: 0.31, confidence: 0.69, uncertain: false },
        concessionSize: { value: 'small', confidence: 0.9, uncertain: false },
      },
    });
  });
});

describe('PlayerConductQuestions', () => {
  it('asks politeness, insult and confidence for a move with text', () => {
    const prepared = conduct.prepare(brainMove('€500k for 15%, final answer.'))!;
    expect(DecisionQuestionsSchema.safeParse(prepared.questions).success).toBe(true);
    expect(
      prepared.interpret({ politeness: score(2), insult: noul(0.05), confidence: score(3.4, 0.5) }, gate),
    ).toEqual({
      conduct: {
        politeness: { value: 2, confidence: 0.9, uncertain: false },
        insult: { value: 0.05, confidence: 0.95, uncertain: false },
        confidence: { value: 3.4, confidence: 0.5, uncertain: true },
      },
    });
  });

  it('does not apply without text', () => {
    expect(conduct.prepare(brainMove(null, { investment: 500_000, equity: 15 }))).toBeNull();
  });
});

describe('fixed question texts', () => {
  it('contain no digits, so they can never carry a hidden investor number', () => {
    // Messages without numbers, so the extraction set contributes nothing dynamic.
    const move = brainMove('Hello there!');
    const sets = [
      new PlayerIntentQuestions(),
      new OfferExtractionQuestions(new OfferCandidateExtractor()),
      deal,
      conduct,
    ];
    for (const set of sets) {
      const prepared = set.prepare(move);
      if (prepared) expect(JSON.stringify(prepared.questions)).not.toMatch(/\d/);
    }
  });
});
