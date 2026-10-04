import type { PlayerOption, PlayTurnRequest } from '@investor/shared';
import { OfferFormatter } from './OfferFormatter';

/** The text of the player's bubble while a move is on its way: what they picked, offered or typed. */
export class PendingMove {
  static text(request: PlayTurnRequest, options: readonly PlayerOption[]): string {
    if (request.offer) return `${OfferFormatter.short(request.offer)}.`;
    if (request.message !== undefined) return request.message.trim();
    const option = options.find((candidate) => candidate.id === request.optionId);
    return option?.label ?? 'Sending your move…';
  }
}
