import type { DecisionInsightsDto, GameListDto, GameSessionDto, Offer } from '@investor/shared';
import { GameNotFoundError } from '../errors/GameNotFoundError.js';
import type { InvestorPersona } from '../personas/InvestorPersona.js';
import type { PersonaCatalog } from '../personas/PersonaCatalog.js';
import type { DecisionLogRepository } from '../repositories/DecisionLogRepository.js';
import type { GameSession, GameSessionRepository } from '../repositories/GameSessionRepository.js';
import type { MessageRepository } from '../repositories/MessageRepository.js';
import type { OfferRepository } from '../repositories/OfferRepository.js';
import type { GameSessionMapper } from './GameSessionMapper.js';

/**
 * Read side of a game. Every lookup is scoped to the requesting player: another player's game and an
 * unknown id both raise GameNotFoundError.
 */
export class GameSessionService {
  constructor(
    private readonly sessions: GameSessionRepository,
    private readonly messages: MessageRepository,
    private readonly offers: OfferRepository,
    private readonly decisionLogs: DecisionLogRepository,
    private readonly personas: PersonaCatalog,
    private readonly mapper: GameSessionMapper,
  ) {}

  /** The owned session, or GameNotFoundError. */
  load(playerId: string, gameId: string): GameSession {
    const session = this.sessions.findForPlayer(gameId, playerId);
    if (!session) throw new GameNotFoundError();
    return session;
  }

  getSession(playerId: string, gameId: string): GameSessionDto {
    return this.view(this.load(playerId, gameId));
  }

  /** The player's games, newest first, as summaries (no transcripts are loaded). */
  listSessions(playerId: string): GameListDto {
    return {
      games: this.sessions
        .listForPlayer(playerId)
        .map((session) => this.mapper.toSummary(session, this.persona(session.personaId))),
    };
  }

  getInsights(playerId: string, gameId: string): DecisionInsightsDto {
    const session = this.load(playerId, gameId);
    return this.mapper.toInsights(this.decisionLogs.listForSession(session.id));
  }

  /** The public view of a session as it is stored now. */
  view(session: GameSession): GameSessionDto {
    const latest = this.offers.latest(session.id, 'player');
    const lastPlayerOffer: Offer | null = latest
      ? {
          investment: latest.investment,
          equity: latest.equity,
          impliedValuation: latest.impliedValuation,
          from: latest.from,
          turn: latest.turn,
        }
      : null;
    return this.mapper.toDto(
      session,
      this.persona(session.personaId),
      this.messages.listForSession(session.id),
      lastPlayerOffer,
    );
  }

  /** A session's persona; a stored id missing from the catalog is a deployment error, not a 404. */
  persona(personaId: string): InvestorPersona {
    const persona = this.personas.findById(personaId);
    if (!persona) throw new Error(`Persona "${personaId}" of a stored game is not in the catalog`);
    return persona;
  }
}
