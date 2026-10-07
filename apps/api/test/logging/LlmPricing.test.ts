import { describe, expect, it } from 'vitest';
import { LlmPricing } from '../../src/logging/LlmPricing.js';
import { captureLogger } from '../support/silentLogger.js';
import { testConfig } from '../support/testConfig.js';

const usage = (overrides: Partial<Parameters<LlmPricing['estimate']>[1]> = {}) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  ...overrides,
});

function setup() {
  const { logger, lines } = captureLogger();
  return { pricing: new LlmPricing(testConfig().llm.pricing, logger), lines };
}

describe('LlmPricing', () => {
  it('prices input and output tokens at their own rates', () => {
    const { pricing } = setup();
    expect(
      pricing.estimate('claude-opus-5-5', usage({ inputTokens: 1_000_000, outputTokens: 100_000 })),
    ).toBe(6);
  });

  it('prices cache reads and cache writes separately', () => {
    const { pricing } = setup();
    expect(pricing.estimate('claude-opus-5-5', usage({ cacheReadInputTokens: 1_000_000 }))).toBe(0.2);
    expect(pricing.estimate('claude-opus-5-5', usage({ cacheCreationInputTokens: 1_000_000 }))).toBe(5);
  });

  it('falls back to the alias price when the reported version has none', () => {
    const { pricing, lines } = setup();
    expect(pricing.estimate('jev-1.13.0', usage({ inputTokens: 1_000_000 }), 'claude-haiku-4-5')).toBe(1);
    expect(lines).toHaveLength(0);
  });

  it('rounds to 6 decimals', () => {
    const { pricing } = setup();
    expect(pricing.estimate('claude-haiku-4-5', usage({ inputTokens: 3, outputTokens: 7 }))).toBe(0.000038);
  });

  it('accepts a dated model id', () => {
    const { pricing } = setup();
    expect(pricing.estimate('claude-haiku-4-5-20251001', usage({ inputTokens: 1_000_000 }))).toBe(1);
  });

  it('returns null and warns once for an unpriced model', () => {
    const { pricing, lines } = setup();
    expect(pricing.estimate('claude-unknown', usage({ inputTokens: 10 }))).toBeNull();
    expect(pricing.estimate('claude-unknown', usage({ inputTokens: 10 }))).toBeNull();
    const warnings = lines.map((line) => JSON.parse(line) as { level: number; model: string });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: 40, model: 'claude-unknown' });
  });
});
