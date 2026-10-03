import type { OfferInput } from '@investor/shared';
import type { LineWriter, VoiceLine } from './LineWriter.js';
import type { VoiceContext } from './VoiceContext.js';

/** The investor's greeting and first offer; code computed the offer (OpeningOfferCalculator). */
export class OpeningGenerator {
  constructor(private readonly writer: LineWriter) {}

  write(context: VoiceContext, offer: OfferInput): Promise<VoiceLine> {
    return this.writer.write(context, { kind: 'opening', offer });
  }
}
