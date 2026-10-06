import type { Logger } from 'pino';
import type { AppConfig } from '../config/AppConfig.js';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

type PriceTable = AppConfig['llm']['pricing'];

const PER_MILLION = 1_000_000;
const DATE_SUFFIX = /-\d{8}$/;

/** Estimated USD cost of a call from the configured per-model prices. An estimate, not the bill. */
export class LlmPricing {
  private readonly warned = new Set<string>();

  constructor(
    private readonly prices: PriceTable,
    private readonly logger: Logger,
  ) {}

  /** Cost rounded to 6 decimals, or `null` (with one warning per model) when the model has no price. */
  estimate(model: string, usage: LlmUsage): number | null {
    const price = this.prices[model] ?? this.prices[model.replace(DATE_SUFFIX, '')];
    if (!price) {
      if (!this.warned.has(model)) {
        this.warned.add(model);
        this.logger.warn(
          { event: 'llm.price_missing', model },
          'no price configured for model, cost not estimated',
        );
      }
      return null;
    }
    const cost =
      (usage.inputTokens * price.inputPerMTok +
        usage.outputTokens * price.outputPerMTok +
        usage.cacheReadInputTokens * price.cacheReadPerMTok +
        usage.cacheCreationInputTokens * price.cacheWritePerMTok) /
      PER_MILLION;
    return Math.round(cost * PER_MILLION) / PER_MILLION;
  }
}
