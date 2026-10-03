import type { OfferInput } from '@investor/shared';
import type { Logger } from 'pino';
import type { InvestorAction } from '../game/InvestorAction.js';
import type { InvestorDialogueGenerator } from './InvestorDialogueGenerator.js';
import type { VoiceLine } from './LineWriter.js';
import type { OpeningGenerator } from './OpeningGenerator.js';
import type { PlayerOptionsGenerator, VoiceOptions } from './PlayerOptionsGenerator.js';
import type { VoiceContext } from './VoiceContext.js';

export interface VoiceTurn {
  line: VoiceLine;
  /** Null when the investor's action ends the game. */
  options: VoiceOptions | null;
}

/**
 * The investor's voice for a turn: the line and the player's options, generated concurrently. Never fails
 * on a provider problem (the parts fall back to code-written text); fallbacks are logged without any prompt
 * or player text.
 */
export class InvestorVoice {
  constructor(
    private readonly opening: OpeningGenerator,
    private readonly dialogue: InvestorDialogueGenerator,
    private readonly playerOptions: PlayerOptionsGenerator,
    private readonly logger: Logger,
  ) {}

  /** The greeting and opening offer, plus the player's first options (their reply is turn 1). */
  async open(context: VoiceContext, offer: OfferInput): Promise<VoiceTurn & { options: VoiceOptions }> {
    const [line, options] = await Promise.all([
      this.opening.write(context, offer),
      this.playerOptions.generate(context, { currentOffer: offer, nextTurn: 1 }),
    ]);
    this.logFallbacks('opening', line, options);
    return { line, options };
  }

  /** The reply to a policy action, plus options for the player's next turn unless the game is over. */
  async respond(
    context: VoiceContext,
    action: InvestorAction,
    { nextTurn }: { nextTurn: number },
  ): Promise<VoiceTurn> {
    const ends = action.kind === 'accept' || action.kind === 'walk_away';
    const [line, options] = await Promise.all([
      this.dialogue.write(context, action),
      ends ? null : this.playerOptions.generate(context, { currentOffer: action.offer, nextTurn }),
    ]);
    this.logFallbacks(action.kind, line, options);
    return { line, options };
  }

  private logFallbacks(kind: string, line: VoiceLine, options: VoiceOptions | null): void {
    if (line.fallback) {
      this.logger.warn(
        { kind, part: 'line', reason: line.fallbackReason },
        'Voice fell back to a template line',
      );
    }
    if (options?.fallback) {
      this.logger.warn(
        { kind, part: 'options', reason: options.fallbackReason },
        'Voice fell back to code-built options',
      );
    }
  }
}
