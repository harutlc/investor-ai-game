import { MoneyFormatter, type Offer, type OfferInput, type PlayTurnRequest } from '@investor/shared';
import type { InvestorBrain } from '../brain/InvestorBrain.js';
import type { NegotiationStateBuilder } from '../brain/NegotiationStateBuilder.js';
import type { PlayerIntent } from '../brain/PlayerIntent.js';
import type { PlayerMoveInterpretation } from '../brain/PlayerMoveInterpretation.js';
import { InvalidMoveError } from '../errors/InvalidMoveError.js';
import type { InvestorPersona } from '../personas/InvestorPersona.js';
import type { GameSession } from '../repositories/GameSessionRepository.js';
import type { PolicyOutcome } from './InvestorAction.js';
import type { NegotiationPolicy } from './NegotiationPolicy.js';
import type { PlayerMoveKind } from './TurnLimiter.js';

/** A player's move, resolved to what the rest of the turn needs. */
export interface ResolvedMove {
  playerMove: PlayerMoveKind;
  /** The player's chat message for this move. */
  chatText: string;
  offer: OfferInput | null;
  /** Free text only: the text Stage B judges for conduct. */
  brainMessage: string | null;
  /** Stage A's intent, when Stage A ran and was sure. */
  intent: PlayerIntent | null;
  /** Set when the injection guard fired; the turn then skips Stage B. */
  dismissal: PolicyOutcome | null;
}

export interface MoveInput {
  session: GameSession;
  persona: InvestorPersona;
  /** Offers made before this move, in turn order. */
  earlierOffers: readonly Offer[];
  turn: number;
  request: PlayTurnRequest;
}

/**
 * Turns a play-turn request into a move. Options and structured offers are taken as they are; free text
 * goes through Stage A and the injection guard, and only confident readings are acted on.
 */
export class MoveResolver {
  constructor(
    private readonly brain: InvestorBrain,
    private readonly states: NegotiationStateBuilder,
    private readonly policy: NegotiationPolicy,
  ) {}

  async resolve(input: MoveInput): Promise<ResolvedMove> {
    const { request, session } = input;
    if (request.optionId !== undefined) return MoveResolver.fromOption(session, request.optionId);
    if (request.offer) {
      const offer = { investment: request.offer.investment, equity: request.offer.equity };
      return MoveResolver.move(
        'other',
        `${MoneyFormatter.compact(offer.investment)} for ${offer.equity}%.`,
        offer,
      );
    }
    if (request.message !== undefined) return this.fromText(input, request.message);
    throw new InvalidMoveError('A move needs an option, an offer or a message');
  }

  private static fromOption(session: GameSession, optionId: string): ResolvedMove {
    const option = session.playerOptions.find((candidate) => candidate.id === optionId);
    if (!option) throw new InvalidMoveError('That option is not available');
    switch (option.kind) {
      case 'accept':
        return MoveResolver.move('accept', option.label, null);
      case 'decline':
        return MoveResolver.move('decline', option.label, null);
      case 'counter': {
        const offer = option.offer
          ? { investment: option.offer.investment, equity: option.offer.equity }
          : null;
        return MoveResolver.move('other', option.label, offer);
      }
      default:
        return MoveResolver.move('other', option.label, null);
    }
  }

  private async fromText(
    { session, persona, earlierOffers, turn }: MoveInput,
    message: string,
  ): Promise<ResolvedMove> {
    const currentOffer = MoveResolver.currentOffer(session);
    const state = this.states.build({ session, persona, playerMessage: message, earlierOffers });
    const reading = await this.brain.understand({ sessionId: session.id, turn, state, message });

    const dismissal = this.policy.guard({
      interpretation: reading,
      investorState: session.investorState,
      currentOffer,
    });
    const confident = reading.intent.uncertain ? null : reading.intent.value;
    const base = { chatText: message, brainMessage: message, intent: confident, dismissal };
    if (dismissal) return { ...base, playerMove: 'other', offer: null };
    if (confident === 'accept' || confident === 'decline')
      return { ...base, playerMove: confident, offer: null };
    return { ...base, playerMove: 'other', offer: MoveResolver.extractedOffer(reading, currentOffer) };
  }

  /** Confident values only; a missing side comes from the investor's offer ("I could do 20%"). */
  private static extractedOffer(reading: PlayerMoveInterpretation, current: OfferInput): OfferInput | null {
    const sure = (value: { value: number; uncertain: boolean } | null) =>
      value && !value.uncertain ? value.value : null;
    const investment = sure(reading.offer.investment);
    const equity = sure(reading.offer.equity);
    if (investment === null && equity === null) return null;
    return { investment: investment ?? current.investment, equity: equity ?? current.equity };
  }

  static currentOffer(session: GameSession): OfferInput {
    const offer = session.currentInvestorOffer;
    if (!offer) throw new Error(`Game ${session.id} has no investor offer`);
    return { investment: offer.investment, equity: offer.equity };
  }

  private static move(playerMove: PlayerMoveKind, chatText: string, offer: OfferInput | null): ResolvedMove {
    return { playerMove, chatText, offer, brainMessage: null, intent: null, dismissal: null };
  }
}
