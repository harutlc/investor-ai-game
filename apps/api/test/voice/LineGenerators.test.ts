import { describe, expect, it } from 'vitest';
import type { InvestorAction } from '../../src/game/InvestorAction.js';
import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import { FakeThinkingProvider } from '../../src/llm/thinking/FakeThinkingProvider.js';
import { InvestorDialogueGenerator } from '../../src/voice/InvestorDialogueGenerator.js';
import { OpeningGenerator } from '../../src/voice/OpeningGenerator.js';
import { OPENING, lineWriter, voiceContext } from '../support/voiceFixtures.js';

const counter: InvestorAction = { kind: 'counter', offer: { investment: 550_000, equity: 24 } };
const context = voiceContext({
  playerOffer: { investment: 500_000, equity: 20 },
  playerMessage: '€500k for 20%.',
});

function dialogue(...replies: (string | Error)[]) {
  const provider = new FakeThinkingProvider(replies);
  return { provider, generator: new InvestorDialogueGenerator(lineWriter(provider)) };
}

describe('InvestorDialogueGenerator', () => {
  it('uses a good first line as it is', async () => {
    const { generator, provider } = dialogue("  Twenty? Cute. I'll do €550k for 24%.  ");
    expect(await generator.write(context, counter)).toEqual({
      text: "Twenty? Cute. I'll do €550k for 24%.",
      fallback: false,
    });
    expect(provider.requests).toHaveLength(1);
  });

  it('retries once with the problems, then uses the second line', async () => {
    const { generator, provider } = dialogue("I'll do €550k for 21%.", 'Fine: €550k for 24%.');
    expect(await generator.write(context, counter)).toEqual({
      text: 'Fine: €550k for 24%.',
      fallback: false,
    });
    const retry = provider.requests[1]!.messages;
    expect(retry.at(-2)).toEqual({ role: 'assistant', content: "I'll do €550k for 21%." });
    expect(retry.at(-1)!.content).toContain('"21%"');
  });

  it('falls back to the template line after two bad lines', async () => {
    const { generator } = dialogue("I'll do €550k for 21%.", 'How about €600k for 25%?');
    expect(await generator.write(context, counter)).toEqual({
      text: "I can do €550k for 24%. That's my offer.",
      fallback: true,
      fallbackReason: 'inconsistent',
    });
  });

  it('falls back when the provider is down', async () => {
    const { generator } = dialogue(new ProviderUnavailableError());
    expect(await generator.write(context, counter)).toMatchObject({
      text: "I can do €550k for 24%. That's my offer.",
      fallback: true,
      fallbackReason: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('treats empty and over-long replies as failures', async () => {
    const { generator } = dialogue('   ', `€550k for 24%. ${'x'.repeat(4000)}`);
    expect((await generator.write(context, counter)).fallback).toBe(true);
  });

  it('writes a walk-away without numbers', async () => {
    const { generator } = dialogue("We're done. Good luck.");
    expect(await generator.write(context, { kind: 'walk_away', reason: 'decided' })).toEqual({
      text: "We're done. Good luck.",
      fallback: false,
    });
  });
});

describe('OpeningGenerator', () => {
  it('states the opening offer', async () => {
    const provider = new FakeThinkingProvider(['GreenCharge, eh? €500k for 30%. Take it or leave it.']);
    const line = await new OpeningGenerator(lineWriter(provider)).write(
      voiceContext({ history: [] }),
      OPENING,
    );
    expect(line).toEqual({ text: 'GreenCharge, eh? €500k for 30%. Take it or leave it.', fallback: false });
    expect(provider.requests[0]!.system).toContain('NUMBERS TO STATE: €500k (€500,000) for 30%.');
  });

  it('rejects an opening without the offer', async () => {
    const provider = new FakeThinkingProvider(['Hello there!', 'Nice to meet you.']);
    const line = await new OpeningGenerator(lineWriter(provider)).write(
      voiceContext({ history: [] }),
      OPENING,
    );
    expect(line.text).toBe("I'm ready to invest €500k for 30% of your company. That's my opening offer.");
  });
});
