import { randomUUID } from 'node:crypto';
import {
  DecisionInsightsDtoSchema,
  GameListDtoSchema,
  GameSessionDtoSchema,
  TurnResultDtoSchema,
  type DecisionAnswer,
  type GameSessionDto,
} from '@investor/shared';
import request, { type Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import { FakeDecisionProvider } from '../../src/llm/decision/FakeDecisionProvider.js';
import { ProviderUnavailableError } from '../../src/llm/errors/ProviderUnavailableError.js';
import { choice, noul, score } from '../support/brainFixtures.js';
import { createTestApp } from '../support/createTestApp.js';
import { UnavailableThinkingProvider } from '../support/thinkingFixtures.js';

type App = ReturnType<typeof createTestApp>['app'];

const PITCH = {
  name: 'GreenCharge',
  sector: 'EV charging',
  description: 'Fast chargers for apartment buildings.',
  valuation: 2_000_000,
  askAmount: 500_000,
};

/** A browser-like agent: its own player cookie and a CSRF token for POSTs. */
async function browser(app: App) {
  const agent = request.agent(app);
  const { csrfToken } = (await agent.get('/api/csrf-token')).body as { csrfToken: string };
  return {
    get: (path: string) => agent.get(path),
    post: (path: string, body: object) => agent.post(path).set('X-CSRF-Token', csrfToken).send(body),
  };
}

function setup() {
  const decisions = new FakeDecisionProvider();
  const { app } = createTestApp({
    decisionProvider: decisions,
    thinkingProvider: new UnavailableThinkingProvider(),
  });
  return { app, decisions };
}

async function startGame(player: Awaited<ReturnType<typeof browser>>, personaId = 'greedy-shark') {
  const res = await player.post('/api/games', { personaId, pitch: PITCH });
  expect(res.status).toBe(201);
  return res.body as GameSessionDto;
}

function stageB(reaction = 'counter'): Record<string, DecisionAnswer> {
  return {
    accept: score(1),
    reaction: choice(reaction),
    good_deal: noul(0.3),
    concession_size: choice('medium'),
    politeness: score(3),
    insult: noul(0.02),
    confidence: score(3),
  };
}

function expectNoStore(res: Response) {
  expect(res.headers['cache-control']).toBe('no-store');
}

describe('POST /api/games', () => {
  it('starts a game: 201 with the public view', async () => {
    const player = await browser(setup().app);
    const res = await player.post('/api/games', { personaId: 'greedy-shark', pitch: PITCH });

    expect(res.status).toBe(201);
    expectNoStore(res);
    const game = GameSessionDtoSchema.parse(res.body);
    expect(game).toMatchObject({ status: 'negotiating', turn: 0 });
    expect(game.messages).toHaveLength(2);
    expect(game.options.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects an invalid pitch and an unknown persona with 400', async () => {
    const player = await browser(setup().app);

    const badPitch = await player.post('/api/games', {
      personaId: 'greedy-shark',
      pitch: { ...PITCH, askAmount: 0 },
    });
    expect(badPitch.status).toBe(400);
    expect(badPitch.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(badPitch.body.error.details)).toContain('body.pitch.askAmount');

    const unknown = await player.post('/api/games', { personaId: 'no-such-investor', pitch: PITCH });
    expect(unknown.status).toBe(400);
    expect(JSON.stringify(unknown.body.error.details)).toContain('personaId');
    expect((await player.get('/api/games')).body).toEqual({ games: [] });
  });

  it('requires a CSRF token', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/games').send({ personaId: 'greedy-shark', pitch: PITCH });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });
});

describe('GET /api/games', () => {
  it("lists only the player's games, newest first", async () => {
    const { app } = setup();
    const alice = await browser(app);
    const bob = await browser(app);
    const first = await startGame(alice);
    const second = await startGame(alice, 'generous-angel');
    await startGame(bob);

    const res = await alice.get('/api/games');

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(GameListDtoSchema.parse(res.body).games.map((game) => game.id)).toEqual([second.id, first.id]);
  });
});

describe('GET /api/games/:id', () => {
  it("returns the owner's game and 404 for anyone else", async () => {
    const { app } = setup();
    const alice = await browser(app);
    const bob = await browser(app);
    const game = await startGame(alice);

    const own = await alice.get(`/api/games/${game.id}`);
    expect(own.status).toBe(200);
    expectNoStore(own);
    expect(GameSessionDtoSchema.parse(own.body).id).toBe(game.id);

    const stranger = await bob.get(`/api/games/${game.id}`);
    const unknown = await alice.get(`/api/games/${randomUUID()}`);
    expect([stranger.status, unknown.status]).toEqual([404, 404]);
    expect(stranger.body.error.code).toBe('NOT_FOUND');
    expect(stranger.body.error.message).toBe(unknown.body.error.message);
  });

  it('rejects a malformed id with 400', async () => {
    const player = await browser(setup().app);
    const res = await player.get('/api/games/not-a-uuid');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('params.id');
  });
});

describe('POST /api/games/:id/turns', () => {
  it('plays a counter-offer turn', async () => {
    const { app, decisions } = setup();
    const player = await browser(app);
    const game = await startGame(player);
    decisions.enqueue(stageB());

    const res = await player.post(`/api/games/${game.id}/turns`, {
      offer: { investment: 500_000, equity: 15 },
    });

    expect(res.status).toBe(200);
    expectNoStore(res);
    const result = TurnResultDtoSchema.parse(res.body);
    expect(result.session.turn).toBe(1);
    expect(result.newMessages.map((message) => message.role)).toEqual(['player', 'investor']);
  });

  it('rejects two inputs with 400 and leaves the game unchanged', async () => {
    const player = await browser(setup().app);
    const game = await startGame(player);

    const res = await player.post(`/api/games/${game.id}/turns`, {
      optionId: game.options[0]!.id,
      message: 'Hi',
    });

    expect(res.status).toBe(400);
    expect((await player.get(`/api/games/${game.id}`)).body.turn).toBe(0);
  });

  it('rejects an unknown option with 422', async () => {
    const player = await browser(setup().app);
    const game = await startGame(player);
    const res = await player.post(`/api/games/${game.id}/turns`, { optionId: 'opt-9-9' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_MOVE');
  });

  it('rejects moves after the game ended with 409', async () => {
    const player = await browser(setup().app);
    const game = await startGame(player);
    const decline = game.options.find((option) => option.kind === 'decline')!;
    expect((await player.post(`/api/games/${game.id}/turns`, { optionId: decline.id })).status).toBe(200);

    const res = await player.post(`/api/games/${game.id}/turns`, {
      offer: { investment: 500_000, equity: 20 },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GAME_FINISHED');
  });

  it('maps a decision outage to 503', async () => {
    const { app, decisions } = setup();
    const player = await browser(app);
    const game = await startGame(player);
    decisions.enqueue(new ProviderUnavailableError());

    const res = await player.post(`/api/games/${game.id}/turns`, {
      offer: { investment: 500_000, equity: 15 },
    });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('GET /api/games/:id/insights', () => {
  it("lists the turn's Stage B decisions", async () => {
    const { app, decisions } = setup();
    const player = await browser(app);
    const game = await startGame(player);
    decisions.enqueue(stageB());
    await player.post(`/api/games/${game.id}/turns`, { offer: { investment: 500_000, equity: 15 } });

    const res = await player.get(`/api/games/${game.id}/insights`);

    expect(res.status).toBe(200);
    expectNoStore(res);
    const insights = DecisionInsightsDtoSchema.parse(res.body);
    expect(insights.entries.map((entry) => [entry.turn, entry.stage])).toEqual([[1, 'B']]);
  });
});

describe('hidden numbers over HTTP', () => {
  const HIDDEN_KEYS = [
    'budget',
    'minEquity',
    'maxEquity',
    'patience',
    'concessionStep',
    'personality',
    'toneInstructions',
    'interest',
    'initialInterest',
  ];
  // The greedy shark's budget, in every way it could be written.
  const BUDGET = ['600000', '€600k', '€600,000'];

  it('never appear in any response of a full game', async () => {
    const { app, decisions } = setup();
    const player = await browser(app);
    const responses: Response[] = [];
    const record = async (pending: Promise<Response>) => {
      const res = await pending;
      responses.push(res);
      return res;
    };

    const game = (await record(player.post('/api/games', { personaId: 'greedy-shark', pitch: PITCH })))
      .body as GameSessionDto;
    decisions.enqueue(stageB());
    await record(player.post(`/api/games/${game.id}/turns`, { offer: { investment: 500_000, equity: 15 } }));
    const freeText = {
      intent: choice('counter_offer'),
      injection: noul(0.02),
      investment: choice('€500,000'),
      equity: choice('20%'),
      ...stageB(),
    };
    decisions.enqueue(freeText, freeText, freeText, freeText);
    const turn2 = await record(
      player.post(`/api/games/${game.id}/turns`, { message: '€500k for 20%, final answer.' }),
    );
    await record(player.get(`/api/games/${game.id}`));
    await record(player.get(`/api/games/${game.id}/insights`));
    const accept = (turn2.body as { session: GameSessionDto }).session.options.find(
      (o) => o.kind === 'accept',
    )!;
    const end = await record(player.post(`/api/games/${game.id}/turns`, { optionId: accept.id }));
    await record(player.get('/api/games'));

    expect(end.body.session.status).toBe('deal');
    expect(responses.map((res) => res.status)).toEqual([201, 200, 200, 200, 200, 200, 200]);
    for (const res of responses) {
      for (const key of HIDDEN_KEYS) expect(res.text).not.toContain(`"${key}"`);
      for (const value of BUDGET) expect(res.text).not.toContain(value);
      expectNoStore(res);
    }
  });
});
