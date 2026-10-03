import { describe, expect, it } from 'vitest';
import { OfferCandidateExtractor } from '../../src/brain/OfferCandidateExtractor.js';

const extractor = new OfferCandidateExtractor();

function values(message: string) {
  const { amounts, equities } = extractor.extract(message);
  return { amounts: amounts.map((c) => c.value), equities: equities.map((c) => c.value) };
}

describe('OfferCandidateExtractor', () => {
  it('reads mixed notations', () => {
    expect(values('€0.5M for 15%, or 450k for 12 percent')).toEqual({
      amounts: [500_000, 450_000],
      equities: [15, 12],
    });
  });

  it('treats comma + three digits as thousands and other commas as decimals', () => {
    expect(values('500,000 for 1,5M valuation')).toEqual({ amounts: [500_000, 1_500_000], equities: [] });
  });

  it('finds nothing in plain text', () => {
    expect(values('Hello there!')).toEqual({ amounts: [], equities: [] });
  });

  it('keeps the token as the player wrote it', () => {
    const { amounts, equities } = extractor.extract('How about €0.5M for 15 pct?');
    expect(amounts).toEqual([{ kind: 'amount', value: 500_000, text: '€0.5M' }]);
    expect(equities).toEqual([{ kind: 'equity', value: 15, text: '15 pct' }]);
  });

  it.each([
    ['$500k', 500_000],
    ['EUR 750000', 750_000],
    ['300000 euros', 300_000],
    ['2 million', 2_000_000],
    ['1.2 mln', 1_200_000],
    ['1,234,567', 1_234_567],
    ['800000', 800_000],
    ['45 EUR', 45],
  ])('reads %s as an amount of %s', (message, expected) => {
    expect(values(message).amounts).toContain(expected);
  });

  it('classifies bare numbers: below 100 as equity, 1,000 and above as amounts', () => {
    expect(values('We have 3 founders and 2500 users, 500 of them paying')).toEqual({
      amounts: [2_500],
      equities: [3],
    });
  });

  it('rounds equity to 2 decimals and amounts to whole euros', () => {
    expect(values('12.345% for 1.2345k')).toEqual({ amounts: [1_235], equities: [12.35] });
  });

  it('ignores numbers with two dots', () => {
    expect(values('1.000.000')).toEqual({ amounts: [], equities: [] });
  });

  it('drops values outside the equity range', () => {
    expect(values('150% or 0% or 100 percent')).toEqual({ amounts: [], equities: [] });
  });

  it('does not take units from the next word or numbers glued to a word', () => {
    expect(values('In Q3 we grew for 3 months')).toEqual({ amounts: [], equities: [3] });
  });

  it('merges duplicates, keeping the first spelling', () => {
    const { amounts } = extractor.extract('500k, I mean €500,000');
    expect(amounts).toEqual([{ kind: 'amount', value: 500_000, text: '500k' }]);
  });

  it('caps each kind at 10 candidates in order of appearance', () => {
    const message = Array.from({ length: 12 }, (_, i) => `€${i + 1}00k`).join(' ');
    const { amounts } = extractor.extract(message);
    expect(amounts.map((c) => c.value)).toEqual(Array.from({ length: 10 }, (_, i) => (i + 1) * 100_000));
  });
});
