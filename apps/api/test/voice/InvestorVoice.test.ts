import { describe, expect, it } from 'vitest';
import { OfferCandidateExtractor } from '../../src/brain/OfferCandidateExtractor.js';
import type { InvestorAction } from '../../src/game/InvestorAction.js';
import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import type { ThinkingProvider } from '../../src/llm/thinking/ThinkingProvider.js';
import { InvestorDialogueGenerator } from '../../src/voice/InvestorDialogueGenerator.js';
import { InvestorVoice } from '../../src/voice/InvestorVoice.js';
import { NumberConsistencyChecker } from '../../src/voice/NumberConsistencyChecker.js';
import { OpeningGenerator } from '../../src/voice/OpeningGenerator.js';
import { PlayerOptionsGenerator } from '../../src/voice/PlayerOptionsGenerator.js';
import { PromptBuilder } from '../../src/voice/PromptBuilder.js';
import { captureLogger } from '../support/silentLogger.js';
import { ScriptedThinkingProvider } from '../support/thinkingFixtures.js';
import { OPENING, lineWriter, numbersInPlay, voiceContext } from '../support/voiceFixtures.js';

const OPTIONS_JSON = JSON.stringify({
  options: [{ kind: 'counter', label: 'Counter: €550k for 22%', investment: 550_000, equity: 22 }],
});
const counter: InvestorAction = { kind: 'counter', offer: { investment: 550_000, equity: 24 } };
const context = voiceContext({ playerOffer: { investment: 500_000, equity: 20 } });

function voice(provider: ThinkingProvider) {
  const { logger, lines } = captureLogger();
  const writer = lineWriter(provider);
  const options = new PlayerOptionsGenerator(
    provider,
    new PromptBuilder(),
    numbersInPlay,
    new NumberConsistencyChecker(new OfferCandidateExtractor()),
  );
  return {
    lines,
    voice: new InvestorVoice(
      new OpeningGenerator(writer),
      new InvestorDialogueGenerator(writer),
      options,
      logger,
    ),
  };
}

describe('InvestorVoice', () => {
  it('generates the line and the options concurrently', async () => {
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => (release = resolve));
    const provider = new ScriptedThinkingProvider(['Fine. €550k for 24%.'], [OPTIONS_JSON], async () => {
      if (++arrived === 2) release();
      await Promise.race([
        both,
        new Promise((_, reject) => setTimeout(() => reject(new Error('requests were not concurrent')), 200)),
      ]);
    });

    const turn = await voice(provider).voice.respond(context, counter, { nextTurn: 3 });

    expect(turn.line).toEqual({ text: 'Fine. €550k for 24%.', fallback: false });
    expect(turn.options?.options.map((option) => option.label)).toEqual([
      'Counter: €550k for 22%',
      'Accept €550k for 24%',
      'Walk away',
    ]);
  });

  it('offers no options when the action ends the game', async () => {
    const { voice: v } = voice(
      new ScriptedThinkingProvider(['You have a deal: €500k for 25%.', "We're done here."], []),
    );
    const accepted = await v.respond(
      context,
      { kind: 'accept', offer: { investment: 500_000, equity: 25 } },
      { nextTurn: 3 },
    );
    const walked = await v.respond(context, { kind: 'walk_away', reason: 'decided' }, { nextTurn: 3 });
    expect([accepted.options, walked.options]).toEqual([null, null]);
  });

  it('falls back on both parts when the provider is down, logging no prompt or player text', async () => {
    const down = new ProviderUnavailableError();
    const secret = 'my secret pitch detail';
    const { voice: v, lines } = voice(new ScriptedThinkingProvider([down], [down]));

    const turn = await v.respond(
      voiceContext({ playerMessage: secret, playerOffer: { investment: 500_000, equity: 20 } }),
      counter,
      {
        nextTurn: 3,
      },
    );

    expect(turn.line).toMatchObject({ fallback: true, fallbackReason: 'PROVIDER_UNAVAILABLE' });
    expect(turn.options).toMatchObject({ fallback: true, fallbackReason: 'PROVIDER_UNAVAILABLE' });
    expect(lines).toHaveLength(2);
    const logged = lines.join('\n');
    expect(logged).toContain('"part":"line"');
    expect(logged).toContain('"part":"options"');
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('RULES');
  });

  it('opens with the offer and options for turn 1', async () => {
    const { voice: v } = voice(new ScriptedThinkingProvider(['€500k for 30%. Your move.'], [OPTIONS_JSON]));
    const turn = await v.open(voiceContext({ history: [] }), OPENING);
    expect(turn.line.text).toBe('€500k for 30%. Your move.');
    expect(turn.options.options.every((option) => option.id.startsWith('opt-1-'))).toBe(true);
  });
});
