import { describe, expect, it } from 'vitest';
import { OfferCandidateExtractor } from '../../src/brain/OfferCandidateExtractor.js';
import { NumberConsistencyChecker } from '../../src/voice/NumberConsistencyChecker.js';
import { NumbersInPlay } from '../../src/voice/NumbersInPlay.js';
import type { LineSubject } from '../../src/voice/VoiceContext.js';
import { OPENING, voiceContext } from '../support/voiceFixtures.js';

const extractor = new OfferCandidateExtractor();
const numbers = new NumbersInPlay(extractor);
const checker = new NumberConsistencyChecker(extractor);
const counter: LineSubject = { kind: 'counter', offer: { investment: 550_000, equity: 24 } };

describe('NumbersInPlay', () => {
  it('collects offers, their valuations, the pitch and numbers the player wrote', () => {
    const allowed = numbers.for(
      voiceContext({
        playerOffer: { investment: 500_000, equity: 15 },
        playerMessage: 'We have 3,000 users.',
      }),
      counter,
    );
    expect(allowed.equities.sort((a, b) => a - b)).toEqual([6, 9, 12, 15, 24, 30]);
    expect(allowed.amounts).toEqual(
      expect.arrayContaining([550_000, 2_291_667, 1_741_667, 500_000, 3_333_333, 2_000_000, 18_000, 3_000]),
    );
    expect(allowed.required).toEqual({ investment: 550_000, equity: 24 });
  });

  it('requires no offer for holding actions', () => {
    expect(numbers.for(voiceContext(), { kind: 'reject', offer: OPENING }).required).toBeNull();
  });
});

describe('NumberConsistencyChecker', () => {
  const allowedFor = (subject: LineSubject, playerOffer = { investment: 500_000, equity: 15 }) =>
    numbers.for(voiceContext({ playerOffer }), subject);

  it('accepts a line that states the decided counter', () => {
    expect(checker.check("Fine. I'll do €550k for 24%.", allowedFor(counter))).toEqual({
      ok: true,
      problems: [],
    });
  });

  it('rejects an invented percentage, naming it', () => {
    const result = checker.check("I'll do €550k for 21%.", allowedFor(counter));
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('"21%"');
  });

  it('accepts a rounded valuation of an offer in play', () => {
    expect(checker.check('That values you at €3.3M. I can do €550k for 24%.', allowedFor(counter)).ok).toBe(
      true,
    );
  });

  it('requires both numbers of the decided offer', () => {
    const result = checker.check("I'll put in €550k.", allowedFor(counter));
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('You must state the offer exactly: €550k for 24%.');
  });

  it("allows numbers from the player's message", () => {
    const allowed = numbers.for(voiceContext({ playerMessage: 'We have 3,000 paying users.' }), {
      kind: 'reject',
      offer: OPENING,
    });
    expect(checker.check('3,000 users is nice. Still €500k for 30%.', allowed).ok).toBe(true);
  });

  it('allows the gap between offers in play', () => {
    const allowed = numbers.for(voiceContext({ playerOffer: { investment: 500_000, equity: 20 } }), counter);
    expect(
      checker.check('That extra €50k buys chargers. €550k for 24%, 4 points from yours.', allowed).ok,
    ).toBe(true);
  });

  it('gives small amounts at least €1,000 of slack', () => {
    expect(
      checker.check(
        'Your €18.5k a month does not impress me.',
        allowedFor({ kind: 'reject', offer: OPENING }),
      ).ok,
    ).toBe(true);
    expect(
      checker.check('Your €25k a month does not impress me.', allowedFor({ kind: 'reject', offer: OPENING }))
        .ok,
    ).toBe(false);
  });
});
