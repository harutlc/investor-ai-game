import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/api/ApiClientError';
import { GameApiClient } from '@/api/GameApiClient';
import { apiError, FakeFetch, json } from '../support/FakeFetch';
import { GAME_ID, PITCH, session, SHARK, turnResult } from '../support/fixtures';

function setup(baseUrl = '') {
  const fake = new FakeFetch();
  return { fake, client: new GameApiClient({ baseUrl, fetch: fake.fetch }) };
}

async function failure(promise: Promise<unknown>): Promise<ApiClientError> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiClientError);
  return error as ApiClientError;
}

describe('GameApiClient responses', () => {
  it('parses a valid body and sends cookies', async () => {
    const { fake, client } = setup();
    fake.reply(json(200, { personas: [SHARK] }));

    await expect(client.listPersonas()).resolves.toEqual({ personas: [SHARK] });
    expect(fake.calls[0]).toMatchObject({ url: '/api/personas', method: 'GET', credentials: 'include' });
  });

  it('prefixes the base URL', async () => {
    const { fake, client } = setup('http://localhost:3001/');
    fake.reply(json(200, session()));

    await client.getGame(GAME_ID);
    expect(fake.calls[0]!.url).toBe(`http://localhost:3001/api/games/${GAME_ID}`);
  });

  it('rejects a body with a hidden field as BAD_RESPONSE', async () => {
    const { fake, client } = setup();
    fake.reply(json(200, { ...session(), budget: 600_000 }));

    const error = await failure(client.getGame(GAME_ID));
    expect(error.code).toBe('BAD_RESPONSE');
  });

  it('maps the error envelope to status and code', async () => {
    const { fake, client } = setup();
    fake.reply(json(404, {}), apiError(409, 'GAME_FINISHED', 'The game is over.'));

    const error = await failure(client.playTurn(GAME_ID, { optionId: 'opt-1' }));
    expect(error).toMatchObject({
      status: 409,
      code: 'GAME_FINISHED',
      message: 'The game is over.',
      requestId: 'req-1',
    });
  });

  it('maps a body that is not an envelope to UNKNOWN', async () => {
    const { fake, client } = setup();
    fake.reply(new Response('<html>Bad gateway</html>', { status: 502 }));

    const error = await failure(client.listGames());
    expect(error).toMatchObject({ status: 502, code: 'UNKNOWN' });
  });

  it('maps a fetch rejection to NETWORK_ERROR', async () => {
    const { fake, client } = setup();
    fake.reply(new TypeError('Failed to fetch'));

    const error = await failure(client.listGames());
    expect(error).toMatchObject({ status: null, code: 'NETWORK_ERROR' });
  });
});

describe('GameApiClient CSRF', () => {
  it('never asks for a token on reads', async () => {
    const { fake, client } = setup();
    fake.reply(json(200, { games: [] }), json(200, session()));

    await client.listGames();
    await client.getGame(GAME_ID);
    expect(fake.calls.map((call) => call.url)).toEqual(['/api/games', `/api/games/${GAME_ID}`]);
    expect(fake.calls.every((call) => !('X-CSRF-Token' in call.headers))).toBe(true);
  });

  it('sends mutations without a header when CSRF is off, and asks only once', async () => {
    const { fake, client } = setup();
    fake.reply(json(404, {}), json(201, session()), json(200, turnResult()));

    await client.startGame({ personaId: 'greedy-shark', pitch: PITCH });
    await client.playTurn(GAME_ID, { message: 'Hi' });

    expect(fake.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/csrf-token',
      'POST /api/games',
      `POST /api/games/${GAME_ID}/turns`,
    ]);
    expect(fake.calls[1]!.headers).not.toHaveProperty('X-CSRF-Token');
    expect(fake.calls[1]!.body).toEqual({ personaId: 'greedy-shark', pitch: PITCH });
  });

  it('sends the token when CSRF is on', async () => {
    const { fake, client } = setup();
    fake.reply(json(200, { csrfToken: 'tok-1' }), json(201, session()));

    await client.startGame({ personaId: 'greedy-shark', pitch: PITCH });
    expect(fake.calls[1]!.headers['X-CSRF-Token']).toBe('tok-1');
  });

  it('refreshes the token once after CSRF_INVALID and retries', async () => {
    const { fake, client } = setup();
    fake.reply(
      json(200, { csrfToken: 'old' }),
      apiError(403, 'CSRF_INVALID'),
      json(200, { csrfToken: 'new' }),
      json(200, turnResult()),
    );

    await expect(client.playTurn(GAME_ID, { optionId: 'opt-1' })).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });
    expect(fake.calls.map((call) => call.headers['X-CSRF-Token'] ?? null)).toEqual([
      null,
      'old',
      null,
      'new',
    ]);
  });

  it('surfaces a second CSRF_INVALID', async () => {
    const { fake, client } = setup();
    fake.reply(
      json(200, { csrfToken: 'old' }),
      apiError(403, 'CSRF_INVALID'),
      json(200, { csrfToken: 'new' }),
      apiError(403, 'CSRF_INVALID'),
    );

    const error = await failure(client.playTurn(GAME_ID, { optionId: 'opt-1' }));
    expect(error).toMatchObject({ status: 403, code: 'CSRF_INVALID' });
    expect(fake.calls).toHaveLength(4);
  });
});
