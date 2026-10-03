import { randomUUID } from 'node:crypto';
import type { Database } from '../../src/db/Database.js';
import { GameSessionRepository, type GameSession } from '../../src/repositories/GameSessionRepository.js';
import { PlayerRepository } from '../../src/repositories/PlayerRepository.js';

export const T0 = new Date('2026-10-03T10:00:00.000Z');

export function seedPlayer(database: Database): string {
  const id = randomUUID();
  new PlayerRepository(database.db).create({ id, createdAt: T0, lastSeenAt: T0 });
  return id;
}

export function sessionFixture(playerId: string, overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: randomUUID(),
    playerId,
    personaId: 'skeptical-analyst',
    scenarioId: null,
    pitch: {
      name: 'GreenCharge',
      sector: 'EV charging',
      description: 'Fast chargers for apartment buildings.',
      valuation: 2_000_000,
      askAmount: 500_000,
    },
    status: 'negotiating',
    phase: 'term_negotiation',
    turn: 0,
    currentInvestorOffer: {
      investment: 500_000,
      equity: 30,
      impliedValuation: 1_666_667,
      from: 'investor',
      turn: 0,
    },
    investorState: {
      budget: 700_000,
      minEquity: 15,
      maxEquity: 30,
      concessionStep: 3,
      interest: 0.72,
      patience: 3,
    },
    playerOptions: [],
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** Seeds a player and one session; returns the session. */
export function seedSession(database: Database, overrides: Partial<GameSession> = {}): GameSession {
  return new GameSessionRepository(database.db).create(sessionFixture(seedPlayer(database), overrides));
}
