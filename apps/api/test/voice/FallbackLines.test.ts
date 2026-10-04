import { describe, expect, it } from 'vitest';
import { OfferCandidateExtractor } from '../../src/brain/OfferCandidateExtractor.js';
import { FallbackLines } from '../../src/voice/FallbackLines.js';
import { NumberConsistencyChecker } from '../../src/voice/NumberConsistencyChecker.js';
import { NumbersInPlay } from '../../src/voice/NumbersInPlay.js';
import type { LineSubject } from '../../src/voice/VoiceContext.js';
import { OPENING, voiceContext } from '../support/voiceFixtures.js';

const extractor = new OfferCandidateExtractor();
const lines = new FallbackLines();
const numbers = new NumbersInPlay(extractor);
const checker = new NumberConsistencyChecker(extractor);
const counterOffer = { investment: 550_000, equity: 24 };

const subjects: LineSubject[] = [
  { kind: 'opening', offer: OPENING },
  { kind: 'counter', offer: counterOffer },
  { kind: 'accept', offer: { investment: 500_000, equity: 22.5 } },
  { kind: 'closing', offer: counterOffer },
  { kind: 'reject', offer: OPENING },
  { kind: 'dismiss', offer: OPENING },
  { kind: 'clarify', offer: OPENING },
  { kind: 'walk_away', offer: null },
];

describe('FallbackLines', () => {
  it.each(subjects.map((subject) => [subject.kind, subject] as const))(
    '%s passes the number check',
    (_kind, subject) => {
      const context = voiceContext({ playerOffer: { investment: 500_000, equity: 22.5 } });
      const text = lines.line(subject);
      expect(checker.check(text, numbers.for(context, subject))).toEqual({ ok: true, problems: [] });
    },
  );

  it('states the decided counter', () => {
    expect(lines.line({ kind: 'counter', offer: counterOffer })).toBe(
      "I can do €550k for 24%. That's my offer.",
    );
  });

  it("states the accepted offer when closing a player's accept", () => {
    expect(lines.line({ kind: 'closing', offer: counterOffer })).toBe('Deal. €550k for 24% it is.');
  });

  it('states no numbers when walking away or asking to clarify', () => {
    expect(lines.line({ kind: 'walk_away', offer: null })).not.toMatch(/\d/);
    expect(lines.line({ kind: 'clarify', offer: OPENING })).not.toMatch(/\d/);
  });
});
