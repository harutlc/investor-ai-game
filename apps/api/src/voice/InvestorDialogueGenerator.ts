import type { InvestorAction } from '../game/InvestorAction.js';
import type { LineWriter, VoiceLine } from './LineWriter.js';
import type { VoiceContext } from './VoiceContext.js';

/** The investor's reply to a policy action, in the persona's voice, with the action's numbers. */
export class InvestorDialogueGenerator {
  constructor(private readonly writer: LineWriter) {}

  write(context: VoiceContext, action: InvestorAction): Promise<VoiceLine> {
    return this.writer.write(context, {
      kind: action.kind,
      offer: action.kind === 'walk_away' ? null : action.offer,
    });
  }
}
