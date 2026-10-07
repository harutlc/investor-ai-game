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
  async load(playerId: string, gameId: string): Promise<GameSession> {
    const session = await this.sessions.findForPlayer(gameId, playerId);
    if (!session) throw new GameNotFoundError();
    return session;
  }

  async getSession(playerId: string, gameId: string): Promise<GameSessionDto> {
    return this.view(await this.load(playerId, gameId));
  }

  /** The player's games, newest first, as summaries (no transcripts are loaded). */
  async listSessions(playerId: string): Promise<GameListDto> {
    const sessions = await this.sessions.listForPlayer(playerId);
    return {
      games: sessions.map((session) => this.mapper.toSummary(session, this.persona(session.personaId))),
    };
  }

  async getInsights(playerId: string, gameId: string): Promise<DecisionInsightsDto> {
    const session = await this.load(playerId, gameId);
    return this.mapper.toInsights(await this.decisionLogs.listForSession(session.id));
  }

  /** The public view of a session as it is stored now. */
  async view(session: GameSession): Promise<GameSessionDto> {
    const latest = await this.offers.latest(session.id, 'player');
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
      await this.messages.listForSession(session.id),
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
