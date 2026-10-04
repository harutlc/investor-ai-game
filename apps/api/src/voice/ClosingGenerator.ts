import type { OfferInput } from '@investor/shared';
import type { LineWriter, VoiceLine } from './LineWriter.js';
import type { VoiceContext } from './VoiceContext.js';

/** The investor's closing line when the player accepts the investor's offer; no policy action is involved. */
export class ClosingGenerator {
  constructor(private readonly writer: LineWriter) {}

  write(context: VoiceContext, offer: OfferInput): Promise<VoiceLine> {
    return this.writer.write(context, { kind: 'closing', offer });
  }
}
