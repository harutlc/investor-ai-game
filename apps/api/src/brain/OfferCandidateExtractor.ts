import { EquityPercentSchema, MoneySchema } from '@investor/shared';

export type OfferCandidateKind = 'amount' | 'equity';

/** A number found in the player's message, normalized. `text` is the token as the player wrote it. */
export interface OfferCandidate {
  kind: OfferCandidateKind;
  value: number;
  text: string;
}

export interface OfferCandidates {
  amounts: OfferCandidate[];
  equities: OfferCandidate[];
}

/** Per kind; with `none` that is 11 options, well under Laya's 20 per choice. */
export const MAX_CANDIDATES_PER_KIND = 10;

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  mm: 1_000_000,
  mln: 1_000_000,
  million: 1_000_000,
};
const PERCENT_UNITS = new Set(['%', 'percent', 'pct']);

/**
 * A number with optional currency before it (`€`, `$`, `EUR `), an optional unit after it (`%`, `percent`,
 * `pct`, `k`, `m`, `mm`, `mln`, `million`) and an optional currency after that (`€`, `eur`, `euro(s)`).
 * Units must not run into a word ("3 months" has no `m` unit). Numbers glued to a word ("Q3") are skipped.
 */
const TOKEN =
  /(?<![\w.,])(?<pre>[€$]|eur\s)?\s?(?<num>\d[\d.,]*\d|\d)(?:\s?(?<unit>%|percent|pct|k|million|mln|mm|m)(?![a-z]))?(?:\s?(?<post>€|euros?\b|eur\b))?/gi;

/**
 * Finds offer candidates in free text ("select instead of generate"): code finds and normalizes every
 * number, and the decision model only picks among them, so it can never invent one.
 */
export class OfferCandidateExtractor {
  extract(message: string): OfferCandidates {
    const amounts = new Map<number, OfferCandidate>();
    const equities = new Map<number, OfferCandidate>();
    for (const match of message.matchAll(TOKEN)) {
      const candidate = OfferCandidateExtractor.candidate(match);
      if (!candidate) continue;
      const bucket = candidate.kind === 'amount' ? amounts : equities;
      if (!bucket.has(candidate.value) && bucket.size < MAX_CANDIDATES_PER_KIND) {
        bucket.set(candidate.value, candidate);
      }
    }
    return { amounts: [...amounts.values()], equities: [...equities.values()] };
  }

  private static candidate(match: RegExpMatchArray): OfferCandidate | null {
    const { pre, num, unit, post } = match.groups ?? {};
    const number = OfferCandidateExtractor.parseNumber(num ?? '');
    if (number === null) return null;
    const text = match[0].trim();
    const lowerUnit = unit?.toLowerCase();

    if (lowerUnit && PERCENT_UNITS.has(lowerUnit)) return OfferCandidateExtractor.equity(number, text);
    if (lowerUnit) return OfferCandidateExtractor.amount(number * MULTIPLIERS[lowerUnit]!, text);
    if (pre || post) return OfferCandidateExtractor.amount(number, text);
    if (number >= 1_000) return OfferCandidateExtractor.amount(number, text);
    if (number > 0 && number < 100) return OfferCandidateExtractor.equity(number, text);
    return null;
  }

  private static amount(value: number, text: string): OfferCandidate | null {
    const rounded = Math.round(value);
    return MoneySchema.safeParse(rounded).success && Number.isSafeInteger(rounded)
      ? { kind: 'amount', value: rounded, text }
      : null;
  }

  private static equity(value: number, text: string): OfferCandidate | null {
    const rounded = Math.round(value * 100) / 100;
    return EquityPercentSchema.safeParse(rounded).success ? { kind: 'equity', value: rounded, text } : null;
  }

  /**
   * A comma followed by exactly three digits groups thousands; any other comma is a decimal point. A dot is
   * always a decimal point, so a number with two dots (`1.000.000`) is ambiguous and ignored.
   */
  private static parseNumber(raw: string): number | null {
    if ((raw.match(/\./g) ?? []).length > 1) return null;
    const normalized = raw.replace(/,(?=\d{3}(?!\d))/g, '').replace(',', '.');
    return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null;
  }
}
