import {
  ChatMessageSchema,
  DecisionInsightsDtoSchema,
  GameSessionDtoSchema,
  GameSummaryDtoSchema,
  type ChatMessage,
  type DecisionInsightsDto,
  type GameSessionDto,
  type GameSummaryDto,
  type Offer,
} from '@investor/shared';
import type { InvestorPersona } from '../personas/InvestorPersona.js';
import type { DecisionLogEntry } from '../repositories/DecisionLogRepository.js';
import type { GameSession } from '../repositories/GameSessionRepository.js';
import type { StoredMessage } from '../repositories/MessageRepository.js';
import type { MeterHintMapper } from './MeterHintMapper.js';

/**
 * Builds the public views of a game. Every field is named explicitly and the result is parsed with the
 * strict shared schema, so a hidden number added by mistake fails loudly instead of reaching the player.
 */
export class GameSessionMapper {
  constructor(
    private readonly meters: MeterHintMapper,
    private readonly maxTurns: number,
  ) {}

  toDto(
    session: GameSession,
    persona: InvestorPersona,
    messages: readonly StoredMessage[],
    lastPlayerOffer: Offer | null,
  ): GameSessionDto {
    return GameSessionDtoSchema.parse({
      id: session.id,
      persona: persona.toPublicDto(),
      pitch: session.pitch,
      status: session.status,
      phase: session.phase,
      turn: session.turn,
      maxTurns: this.maxTurns,
      currentInvestorOffer: session.currentInvestorOffer,
      lastPlayerOffer,
      meters: this.meters.toMeters(session.investorState),
      messages: messages.map((message) => this.toMessage(message)),
      options: session.status === 'negotiating' ? session.playerOptions : [],
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    });
  }

  /** A game for the list: no transcript, no options. */
  toSummary(session: GameSession, persona: InvestorPersona): GameSummaryDto {
    return GameSummaryDtoSchema.parse({
      id: session.id,
      persona: persona.toPublicDto(),
      startupName: session.pitch.name,
      status: session.status,
      turn: session.turn,
      maxTurns: this.maxTurns,
      currentInvestorOffer: session.currentInvestorOffer,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    });
  }

  toMessage(message: StoredMessage): ChatMessage {
    return ChatMessageSchema.parse({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
    });
  }

  toInsights(entries: readonly DecisionLogEntry[]): DecisionInsightsDto {
    return DecisionInsightsDtoSchema.parse({
      entries: entries.map((entry) => ({
        turn: entry.turn,
        stage: entry.stage,
        provider: entry.provider,
        model: entry.model,
        questions: entry.questions,
        answers: entry.answers,
        errorCode: entry.errorCode,
        latencyMs: entry.latencyMs,
        createdAt: entry.createdAt.toISOString(),
      })),
    });
  }
}
