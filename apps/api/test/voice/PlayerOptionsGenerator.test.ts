import { PlayerOptionSchema, type OfferInput } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { OfferCandidateExtractor } from '../../src/brain/OfferCandidateExtractor.js';
import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import { FakeThinkingProvider } from '../../src/llm/thinking/FakeThinkingProvider.js';
import { NumberConsistencyChecker } from '../../src/voice/NumberConsistencyChecker.js';
import { PlayerOptionsGenerator } from '../../src/voice/PlayerOptionsGenerator.js';
import { PromptBuilder } from '../../src/voice/PromptBuilder.js';
import { numbersInPlay, voiceContext } from '../support/voiceFixtures.js';

const CURRENT: OfferInput = { investment: 550_000, equity: 24 };
const context = voiceContext({
  history: [
    { role: 'investor', text: "I'll put in €550k for 24%." },
    { role: 'player', text: 'Why the extra €50k?' },
  ],
  playerOffer: { investment: 500_000, equity: 20 },
  previousInvestorOffer: { investment: 500_000, equity: 26 },
});

function generator(...replies: (string | Error)[]) {
  const provider = new FakeThinkingProvider(replies);
  return new PlayerOptionsGenerator(
    provider,
    new PromptBuilder(),
    numbersInPlay,
    new NumberConsistencyChecker(new OfferCandidateExtractor()),
  );
}

const json = (options: unknown[]) => JSON.stringify({ options });
const generate = (gen: PlayerOptionsGenerator, ctx = context, currentOffer = CURRENT) =>
  gen.generate(ctx, { currentOffer, nextTurn: 4 });

describe('PlayerOptionsGenerator', () => {
  it('keeps valid suggestions and adds Accept and Walk away', async () => {
    const result = await generate(
      generator(
        json([
          { kind: 'counter', label: 'Counter: €550k for 22%', investment: 550_000, equity: 22 },
          { kind: 'message', label: 'Ask what the extra €50k is for' },
        ]),
      ),
    );
    expect(result.fallback).toBe(false);
    expect(result.options.map((option) => [option.id, option.kind, option.label])).toEqual([
      ['opt-4-1', 'counter', 'Counter: €550k for 22%'],
      ['opt-4-2', 'message', 'Ask what the extra €50k is for'],
      ['opt-4-3', 'accept', 'Accept €550k for 24%'],
      ['opt-4-4', 'decline', 'Walk away'],
    ]);
    expect(result.options[0]!.offer).toEqual({
      investment: 550_000,
      equity: 22,
      impliedValuation: 2_500_000,
      from: 'player',
      turn: 4,
    });
  });

  it('relabels a counter whose label disagrees with its numbers', async () => {
    const result = await generate(
      generator(
        json([{ kind: 'counter', label: 'Counter: €500k for 18%', investment: 500_000, equity: 20 }]),
      ),
    );
    expect(result.options[0]!.label).toBe('Counter: €500k for 20%');
  });

  it("drops a counter equal to the investor's offer, duplicates and invented numbers", async () => {
    const result = await generate(
      generator(
        json([
          { kind: 'counter', label: 'Counter: €550k for 24%', investment: 550_000, equity: 24 },
          { kind: 'counter', label: 'Counter: €550k for 22%', investment: 550_000, equity: 22 },
          { kind: 'counter', label: 'Same again', investment: 550_000, equity: 22 },
          { kind: 'leverage', label: 'Mention a €2M offer from another fund' },
          { kind: 'accept', label: 'Accept' },
          { kind: 'counter', label: 'Bad numbers', investment: 0, equity: 150 },
        ]),
      ),
    );
    expect(result.options.map((option) => option.label)).toEqual([
      'Counter: €550k for 22%',
      'Mention a €2M offer from another fund',
      'Accept €550k for 24%',
      'Walk away',
    ]);
  });

  it('keeps at most three suggestions', async () => {
    const result = await generate(
      generator(
        json([
          { kind: 'message', label: 'One' },
          { kind: 'message', label: 'Two' },
          { kind: 'message', label: 'Three' },
          { kind: 'message', label: 'Four' },
        ]),
      ),
    );
    expect(result.options).toHaveLength(5);
  });

  it('builds the options in code when generation fails', async () => {
    const result = await generate(generator('not json', 'still not json'));
    expect(result).toMatchObject({ fallback: true, fallbackReason: 'PROVIDER_BAD_RESPONSE' });
    expect(result.options.map((option) => option.label)).toEqual([
      'Counter: €550k for 22%',
      'Accept €550k for 24%',
      'Walk away',
    ]);
  });

  it('builds the options in code when the provider is down', async () => {
    const result = await generate(generator(new ProviderUnavailableError()));
    expect(result).toMatchObject({ fallback: true, fallbackReason: 'PROVIDER_UNAVAILABLE' });
    expect(result.options).toHaveLength(3);
  });

  it('uses three quarters of the investor equity without a player offer', async () => {
    const result = await generate(generator(json([])), voiceContext({ playerOffer: null }));
    expect(result.options[0]!.label).toBe('Counter: €550k for 18%');
    expect(result.fallbackReason).toBe('no_usable_suggestion');
  });

  it('always returns 3 to 5 valid options with unique ids', async () => {
    const replies = [
      json([]),
      json([{ kind: 'message', label: 'Hm' }]),
      json([
        { kind: 'message', label: 'A' },
        { kind: 'leverage', label: 'B' },
        { kind: 'counter', label: 'C', investment: 520_000, equity: 21.5 },
      ]),
    ];
    for (const reply of replies) {
      const { options } = await generate(generator(reply));
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.length).toBeLessThanOrEqual(5);
      expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
      for (const option of options) expect(PlayerOptionSchema.safeParse(option).success).toBe(true);
    }
  });
});
