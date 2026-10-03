import { randomUUID } from 'node:crypto';
import {
  MoneyFormatter,
  TurnResultDtoSchema,
  ValuationCalculator,
  type ChatRole,
  type CreateGameRequest,
  type GameSessionDto,
  type GameStatus,
  type Offer,
  type OfferInput,
  type OfferSide,
  type PlayerOption,
  type PlayTurnRequest,
  type TurnResultDto,
} from '@investor/shared';
import type { InvestorBrain } from '../brain/InvestorBrain.js';
import type { NegotiationStateBuilder } from '../brain/NegotiationStateBuilder.js';
import type { Database } from '../db/Database.js';
import { GameAlreadyFinishedError } from '../errors/GameAlreadyFinishedError.js';
import { TurnInProgressError } from '../errors/TurnInProgressError.js';
import { ValidationError } from '../errors/ValidationError.js';
import type { InvestorPersona } from '../personas/InvestorPersona.js';
import type { PersonaCatalog } from '../personas/PersonaCatalog.js';
import type { GameSession, GameSessionRepository } from '../repositories/GameSessionRepository.js';
import type { MessageRepository, StoredMessage } from '../repositories/MessageRepository.js';
import type { OfferRepository } from '../repositories/OfferRepository.js';
import type { Clock } from '../services/PlayerService.js';
import type { InvestorVoice } from '../voice/InvestorVoice.js';
import type { VoiceContext } from '../voice/VoiceContext.js';
import type { GameSessionMapper } from './GameSessionMapper.js';
import type { GameSessionService } from './GameSessionService.js';
import type { InvestorState } from './InvestorState.js';
import { MoveResolver, type ResolvedMove } from './MoveResolver.js';
import type { NegotiationPolicy } from './NegotiationPolicy.js';
import type { OpeningOfferCalculator } from './OpeningOfferCalculator.js';
import type { TurnLimiter } from './TurnLimiter.js';
import type { TurnLock } from './TurnLock.js';

export interface GameEngineDeps {
  database: Database;
  sessions: GameSessionRepository;
  messages: MessageRepository;
  offers: OfferRepository;
  personas: PersonaCatalog;
  service: GameSessionService;
  mapper: GameSessionMapper;
  resolver: MoveResolver;
  states: NegotiationStateBuilder;
  brain: InvestorBrain;
  policy: NegotiationPolicy;
  limiter: TurnLimiter;
  opening: OpeningOfferCalculator;
  voice: InvestorVoice;
  lock: TurnLock;
  clock?: Clock;
}

/** What one turn decided, before anything is written. */
interface TurnOutcome {
  status: GameStatus;
  investorState: InvestorState;
  /** The offer the investor stands behind after the turn; unchanged offers keep their original turn. */
  currentOffer: Offer;
  /** The investor's reply, or a system note when there is none (the player walked away). */
  reply: { role: ChatRole; text: string };
  /** Offers made this turn, in order. */
  newOffers: { side: OfferSide; terms: OfferInput }[];
  options: PlayerOption[];
}

/**
 * Runs games: the opening, then one turn per player move (brain → policy → voice). Every model call
 * finishes before anything is written, and a turn's writes happen in one transaction, so a failed turn
 * leaves the game as it was (apart from the decision log).
 */
export class GameEngine {
  private readonly clock: Clock;

  constructor(private readonly deps: GameEngineDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async startGame(playerId: string, request: CreateGameRequest): Promise<GameSessionDto> {
    const { personas, opening, voice, database, sessions, messages, offers, service } = this.deps;
    const persona = personas.findById(request.personaId);
    if (!persona) throw new ValidationError([{ path: 'personaId', message: 'is not a known persona' }]);

    const { initialInterest, ...numbers } = persona.numbers;
    const investorState: InvestorState = { ...numbers, interest: initialInterest };
    const terms = opening.offer(request.pitch, investorState);
    const sessionId = randomUUID();
    const system = this.message(
      sessionId,
      'system',
      `Negotiation started with ${persona.name}. You ask ${MoneyFormatter.compact(request.pitch.askAmount)} ` +
        `at a ${MoneyFormatter.compact(request.pitch.valuation)} pre-money valuation.`,
    );
    const context: VoiceContext = {
      persona,
      pitch: request.pitch,
      history: [{ role: system.role, text: system.text }],
      playerMessage: null,
      playerOffer: null,
      previousInvestorOffer: null,
    };
    const { line, options } = await voice.open(context, terms);

    const now = this.clock();
    const session: GameSession = {
      id: sessionId,
      playerId,
      personaId: persona.id,
      scenarioId: null,
      pitch: request.pitch,
      status: 'negotiating',
      phase: 'term_negotiation',
      turn: 0,
      currentInvestorOffer: GameEngine.offer(terms, 'investor', 0),
      investorState,
      playerOptions: options.options,
      createdAt: now,
      updatedAt: now,
    };
    const investorLine = this.message(sessionId, 'investor', line.text);
    database.transaction(() => {
      sessions.create(session);
      messages.add(system);
      messages.add(investorLine);
      offers.add({ ...GameEngine.offer(terms, 'investor', 0), id: randomUUID(), sessionId, createdAt: now });
    });
    return service.view(session);
  }

  async playTurn(playerId: string, gameId: string, request: PlayTurnRequest): Promise<TurnResultDto> {
    const { service, lock } = this.deps;
    // Load and lock with no await in between, so two requests cannot both pass the checks.
    const session = service.load(playerId, gameId);
    if (session.status !== 'negotiating') throw new GameAlreadyFinishedError();
    lock.acquire(session.id);
    try {
      return await this.runTurn(session, request);
    } finally {
      lock.release(session.id);
    }
  }

  private async runTurn(session: GameSession, request: PlayTurnRequest): Promise<TurnResultDto> {
    const { service, offers, resolver } = this.deps;
    const turn = session.turn + 1;
    const persona = service.persona(session.personaId);
    const earlierOffers: Offer[] = offers.listForSession(session.id).map((stored) => ({
      investment: stored.investment,
      equity: stored.equity,
      impliedValuation: stored.impliedValuation,
      from: stored.from,
      turn: stored.turn,
    }));
    const move = await resolver.resolve({ session, persona, earlierOffers, turn, request });
    const playerMessage = this.message(session.id, 'player', move.chatText);
    const outcome = await this.decide(session, persona, earlierOffers, move, turn);
    const reply = this.message(session.id, outcome.reply.role, outcome.reply.text);
    this.save(session, turn, playerMessage, reply, outcome);

    const saved = service.load(session.playerId, session.id);
    return TurnResultDtoSchema.parse({
      session: service.view(saved),
      newMessages: [playerMessage, reply].map((message) => this.deps.mapper.toMessage(message)),
    });
  }

  /** Every model call of the turn happens here; nothing is written yet. */
  private async decide(
    session: GameSession,
    persona: InvestorPersona,
    earlierOffers: readonly Offer[],
    move: ResolvedMove,
    turn: number,
  ): Promise<TurnOutcome> {
    const { states, brain, policy, limiter } = this.deps;
    const currentOffer = MoveResolver.currentOffer(session);
    const context = this.voiceContext(session, persona, move, currentOffer);
    const kept = { investorState: session.investorState, currentOffer: session.currentInvestorOffer! };

    if (move.playerMove === 'decline') {
      return {
        ...kept,
        status: 'rejected_by_player',
        reply: { role: 'system', text: 'You walked away from the negotiation.' },
        newOffers: [],
        options: [],
      };
    }
    if (move.playerMove === 'accept') {
      const { line } = await this.deps.voice.respond(
        context,
        { kind: 'accept', offer: currentOffer },
        { nextTurn: turn + 1 },
      );
      return {
        ...kept,
        status: 'deal',
        reply: { role: 'investor', text: line.text },
        newOffers: [],
        options: [],
      };
    }

    let outcome = move.dismissal;
    if (!outcome) {
      const state = states.build({
        session,
        persona,
        playerOffer: move.offer,
        playerMessage: move.chatText,
        playerIntent: move.intent,
        earlierOffers,
      });
      const judgment = await brain.evaluate({
        sessionId: session.id,
        turn,
        state,
        message: move.brainMessage,
      });
      outcome = policy.decide({
        judgment,
        investorState: session.investorState,
        currentOffer,
        playerOffer: move.offer,
      });
    }

    const { action, investorState } = outcome;
    const status = limiter.statusAfter({ playerMove: 'other', action, turn });
    const voiced = await this.deps.voice.respond(context, action, { nextTurn: turn + 1 });
    const newOffers: TurnOutcome['newOffers'] = [];
    if (move.offer) newOffers.push({ side: 'player', terms: move.offer });
    if (action.kind === 'counter' || action.kind === 'accept')
      newOffers.push({ side: 'investor', terms: action.offer });
    return {
      status,
      investorState,
      currentOffer:
        action.kind === 'counter' || action.kind === 'accept'
          ? GameEngine.offer(action.offer, 'investor', turn)
          : session.currentInvestorOffer!,
      reply: { role: 'investor', text: voiced.line.text },
      newOffers,
      options: status === 'negotiating' ? (voiced.options?.options ?? []) : [],
    };
  }

  /** One transaction for everything the turn produced; a concurrent writer makes it roll back. */
  private save(
    session: GameSession,
    turn: number,
    playerMessage: StoredMessage,
    reply: StoredMessage,
    outcome: TurnOutcome,
  ): void {
    const { database, messages, offers, sessions } = this.deps;
    database.transaction(() => {
      messages.add(playerMessage);
      messages.add(reply);
      for (const { side, terms } of outcome.newOffers) {
        offers.add({
          ...GameEngine.offer(terms, side, turn),
          id: randomUUID(),
          sessionId: session.id,
          createdAt: this.clock(),
        });
      }
      const changed = sessions.update(
        session.id,
        {
          turn,
          status: outcome.status,
          phase: outcome.status === 'negotiating' ? session.phase : 'finished',
          currentInvestorOffer: outcome.currentOffer,
          investorState: outcome.investorState,
          playerOptions: outcome.options,
        },
        { expectedTurn: session.turn },
      );
      if (!changed) throw new TurnInProgressError();
    });
  }

  private voiceContext(
    session: GameSession,
    persona: InvestorPersona,
    move: ResolvedMove,
    currentOffer: OfferInput,
  ): VoiceContext {
    const history = this.deps.messages
      .listForSession(session.id)
      .map((message) => ({ role: message.role, text: message.text }));
    history.push({ role: 'player', text: move.chatText });
    return {
      persona,
      pitch: session.pitch,
      history,
      playerMessage: move.chatText,
      playerOffer: move.offer,
      previousInvestorOffer: currentOffer,
    };
  }

  private static offer(terms: OfferInput, from: OfferSide, turn: number): Offer {
    return {
      investment: terms.investment,
      equity: terms.equity,
      impliedValuation: ValuationCalculator.impliedPostMoney(terms.investment, terms.equity),
      from,
      turn,
    };
  }

  private message(sessionId: string, role: ChatRole, text: string): StoredMessage {
    return { id: randomUUID(), sessionId, role, text, createdAt: this.clock() };
  }
}
