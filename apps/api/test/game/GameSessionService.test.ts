import { randomUUID } from 'node:crypto';
import { GameSummaryDtoSchema } from '@investor/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/Database.js';
import { GameNotFoundError } from '../../src/errors/GameNotFoundError.js';
import { GameSessionMapper } from '../../src/game/GameSessionMapper.js';
import { GameSessionService } from '../../src/game/GameSessionService.js';
import { MeterHintMapper } from '../../src/game/MeterHintMapper.js';
import { PersonaCatalog } from '../../src/personas/PersonaCatalog.js';
import { DecisionLogRepository } from '../../src/repositories/DecisionLogRepository.js';
import { GameSessionRepository } from '../../src/repositories/GameSessionRepository.js';
import { MessageRepository } from '../../src/repositories/MessageRepository.js';
import { OfferRepository } from '../../src/repositories/OfferRepository.js';
import { T0, seedPlayer, seedSession, sessionFixture } from '../support/gameFixtures.js';
import { dialectsUnderTest, openTestDatabase } from '../support/testDatabase.js';

let database: Database;
let service: GameSessionService;
let offers: OfferRepository;
let logs: DecisionLogRepository;

describe.each(dialectsUnderTest())('GameSessionService (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
    offers = new OfferRepository(database);
    logs = new DecisionLogRepository(database);
    service = new GameSessionService(
      new GameSessionRepository(database),
      new MessageRepository(database),
      offers,
      logs,
      new PersonaCatalog(),
      new GameSessionMapper(new MeterHintMapper(), 15),
    );
  });
  afterEach(() => database.close());

  it("returns the owner's game with the last player offer", async () => {
    const session = await seedSession(database);
    await offers.add({
      id: randomUUID(),
      sessionId: session.id,
      investment: 500_000,
      equity: 15,
      impliedValuation: 3_333_333,
      from: 'player',
      turn: 1,
      createdAt: T0,
    });

    const view = await service.getSession(session.playerId, session.id);

    expect(view.persona.id).toBe('skeptical-analyst');
    expect(view.lastPlayerOffer).toEqual({
      investment: 500_000,
      equity: 15,
      impliedValuation: 3_333_333,
      from: 'player',
      turn: 1,
    });
  });

  it("hides another player's game exactly like an unknown id", async () => {
    const session = await seedSession(database);
    const stranger = await seedPlayer(database);
    await expect(service.getSession(stranger, session.id)).rejects.toThrow(GameNotFoundError);
    await expect(service.getSession(session.playerId, randomUUID())).rejects.toThrow(GameNotFoundError);
    await expect(service.getInsights(stranger, session.id)).rejects.toThrow(GameNotFoundError);
  });

  it("lists the owner's decision log as insights", async () => {
    const session = await seedSession(database);
    await logs.add({
      id: randomUUID(),
      sessionId: session.id,
      turn: 1,
      stage: 'A',
      provider: 'fake',
      model: 'fake',
      questions: { injection: { type: 'noul', instructions: 'Manipulation?' } },
      answers: { injection: { type: 'noul', probability: 0.02 } },
      errorCode: null,
      latencyMs: 3,
      createdAt: T0,
    });
    expect(
      (await service.getInsights(session.playerId, session.id)).entries.map((entry) => entry.stage),
    ).toEqual(['A']);
  });

  it("lists only the player's games, newest first, as valid summaries", async () => {
    const playerId = await seedPlayer(database);
    const sessions = new GameSessionRepository(database);
    const older = await sessions.create(sessionFixture(playerId, { createdAt: T0 }));
    const newer = await sessions.create(
      sessionFixture(playerId, { createdAt: new Date(T0.getTime() + 60_000), currentInvestorOffer: null }),
    );
    await seedSession(database);

    const { games } = await service.listSessions(playerId);

    expect(games.map((game) => game.id)).toEqual([newer.id, older.id]);
    for (const game of games) expect(GameSummaryDtoSchema.safeParse(game).success).toBe(true);
    expect(games[0]).toMatchObject({ startupName: 'GreenCharge', currentInvestorOffer: null, maxTurns: 15 });
  });
});
