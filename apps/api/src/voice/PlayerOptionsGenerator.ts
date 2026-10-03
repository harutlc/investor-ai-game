import {
  EquityPercentSchema,
  MoneyFormatter,
  MoneySchema,
  PlayerOptionSchema,
  ValuationCalculator,
  type OfferInput,
  type PlayerOption,
} from '@investor/shared';
import { z } from 'zod';
import { ProviderBadResponseError } from '../llm/errors/ProviderBadResponseError.js';
import { ProviderUnavailableError } from '../llm/errors/ProviderUnavailableError.js';
import type { ThinkingProvider } from '../llm/thinking/ThinkingProvider.js';
import type { NumberConsistencyChecker } from './NumberConsistencyChecker.js';
import type { NumbersInPlay } from './NumbersInPlay.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { VoiceContext } from './VoiceContext.js';

/** At most this many model suggestions; with Accept and Walk away that is 5 options. */
export const MAX_SUGGESTIONS = 3;
const MAX_LABEL_LENGTH = 120;

/** Lenient on purpose: one odd suggestion is dropped by code instead of failing the whole reply. */
const SuggestionsSchema = z.object({
  options: z.array(
    z.object({
      kind: z.string(),
      label: z.string(),
      investment: z.number().optional(),
      equity: z.number().optional(),
    }),
  ),
});
type Suggestion = z.infer<typeof SuggestionsSchema>['options'][number];

export interface VoiceOptions {
  options: PlayerOption[];
  /** True when generation failed or nothing usable came back, so code built the options. */
  fallback: boolean;
  fallbackReason?: string;
}

export interface OptionsTurn {
  /** The investor's offer the player is answering. */
  currentOffer: OfferInput;
  /** The turn the player's reply will be; counter offers carry it. */
  nextTurn: number;
}

type DraftOption = Omit<PlayerOption, 'id'>;

/**
 * The player's reply options. The thinking model suggests; code validates every number, recomputes
 * valuations, fixes labels, drops duplicates, and always adds Accept and Walk away.
 */
export class PlayerOptionsGenerator {
  constructor(
    private readonly provider: ThinkingProvider,
    private readonly prompts: PromptBuilder,
    private readonly numbers: NumbersInPlay,
    private readonly checker: NumberConsistencyChecker,
  ) {}

  async generate(context: VoiceContext, turn: OptionsTurn): Promise<VoiceOptions> {
    let suggestions: Suggestion[] = [];
    let fallbackReason: string | undefined;
    try {
      const request = { ...this.prompts.options(context, turn.currentOffer), schema: SuggestionsSchema };
      suggestions = (await this.provider.generateJson(request)).data.options;
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError || error instanceof ProviderBadResponseError))
        throw error;
      fallbackReason = error.code;
    }

    const drafts = this.keep(context, turn, suggestions);
    if (drafts.length === 0) {
      drafts.push(PlayerOptionsGenerator.midpointCounter(context, turn));
      fallbackReason ??= 'no_usable_suggestion';
    }
    const { currentOffer } = turn;
    drafts.push(
      { kind: 'accept', label: `Accept ${PlayerOptionsGenerator.terms(currentOffer)}` },
      { kind: 'decline', label: 'Walk away' },
    );

    const options = drafts.map((draft, index) =>
      PlayerOptionSchema.parse({ id: `opt-${turn.nextTurn}-${index + 1}`, ...draft }),
    );
    return fallbackReason === undefined
      ? { options, fallback: false }
      : { options, fallback: true, fallbackReason };
  }

  /** Validates the model's suggestions in order and keeps at most three. */
  private keep(context: VoiceContext, turn: OptionsTurn, suggestions: readonly Suggestion[]): DraftOption[] {
    const allowed = this.numbers.for(context, { kind: 'reject', offer: turn.currentOffer });
    const seenTerms = new Set([PlayerOptionsGenerator.key(turn.currentOffer)]);
    const seenLabels = new Set<string>();
    const kept: DraftOption[] = [];

    for (const suggestion of suggestions) {
      if (kept.length === MAX_SUGGESTIONS) break;
      const label = suggestion.label.trim();
      if (!label || label.length > MAX_LABEL_LENGTH) continue;

      let draft: DraftOption;
      if (suggestion.kind === 'counter') {
        const { investment, equity } = suggestion;
        if (!MoneySchema.safeParse(investment).success || !EquityPercentSchema.safeParse(equity).success)
          continue;
        const terms = { investment: investment!, equity: equity! };
        if (seenTerms.has(PlayerOptionsGenerator.key(terms))) continue;
        seenTerms.add(PlayerOptionsGenerator.key(terms));
        draft = {
          kind: 'counter',
          label: this.labelMatches(label, terms) ? label : `Counter: ${PlayerOptionsGenerator.terms(terms)}`,
          offer: {
            ...terms,
            impliedValuation: ValuationCalculator.impliedPostMoney(terms.investment, terms.equity),
            from: 'player',
            turn: turn.nextTurn,
          },
        };
      } else if (suggestion.kind === 'message' || suggestion.kind === 'leverage') {
        if (!this.checker.check(label, allowed).ok) continue;
        draft = { kind: suggestion.kind, label };
      } else {
        continue;
      }
      if (seenLabels.has(draft.label)) continue;
      seenLabels.add(draft.label);
      kept.push(draft);
    }
    return kept;
  }

  /** A counter's label must state exactly its own two numbers and no others. */
  private labelMatches(label: string, terms: OfferInput): boolean {
    return this.checker.check(label, {
      amounts: [terms.investment],
      equities: [terms.equity],
      required: terms,
    }).ok;
  }

  /**
   * Code-built counter: halfway between the investor's equity and the player's last one (three quarters of
   * the investor's equity without a player offer), rounded to half a point, always below the investor's.
   */
  private static midpointCounter(
    context: VoiceContext,
    { currentOffer, nextTurn }: OptionsTurn,
  ): DraftOption {
    const target = context.playerOffer
      ? (currentOffer.equity + context.playerOffer.equity) / 2
      : currentOffer.equity * 0.75;
    let equity = Math.round(target * 2) / 2;
    if (equity >= currentOffer.equity) equity = currentOffer.equity - 0.5;
    equity = Math.max(0.5, equity);
    const terms = { investment: currentOffer.investment, equity };
    return {
      kind: 'counter',
      label: `Counter: ${PlayerOptionsGenerator.terms(terms)}`,
      offer: {
        ...terms,
        impliedValuation: ValuationCalculator.impliedPostMoney(terms.investment, terms.equity),
        from: 'player',
        turn: nextTurn,
      },
    };
  }

  private static terms(offer: OfferInput): string {
    return `${MoneyFormatter.compact(offer.investment)} for ${offer.equity}%`;
  }

  private static key(offer: OfferInput): string {
    return `${offer.investment}/${offer.equity}`;
  }
}
