import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { sessionApp } from '../support/sessionApp.js';

function setCookies(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  return header === undefined ? [] : Array.isArray(header) ? header : [header];
}

describe('PlayerSessionMiddleware', () => {
  it('creates a player and sets a hardened signed cookie on the first visit', async () => {
    const { app, players } = await sessionApp();
    const res = await request(app).get('/whoami');
    const cookie = setCookies(res).find((c) => c.startsWith('inv.pid='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain(`inv.pid=s%3A${res.body.playerId as string}.`); // signed value
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).not.toMatch(/Secure/);
    expect(await players.count()).toBe(1);
  });

  it('reuses the player on a returning visit without creating another', async () => {
    const { app, players } = await sessionApp();
    const agent = request.agent(app);
    const first = await agent.get('/whoami');
    const second = await agent.get('/whoami');
    expect(second.body.playerId).toBe(first.body.playerId);
    expect(setCookies(second).some((c) => c.startsWith('inv.pid='))).toBe(false);
    expect(await players.count()).toBe(1);
  });

  it('ignores a tampered cookie and issues a new player', async () => {
    const { app } = await sessionApp();
    const first = await request(app).get('/whoami');
    const victimId = first.body.playerId as string;
    const forged = await request(app).get('/whoami').set('Cookie', `inv.pid=s%3A${victimId}.forgedsignature`);
    expect(forged.body.playerId).not.toBe(victimId);
    const unsigned = await request(app).get('/whoami').set('Cookie', `inv.pid=${victimId}`);
    expect(unsigned.body.playerId).not.toBe(victimId);
  });

  it('uses the __Host- prefix and Secure in production', async () => {
    const { app } = await sessionApp({ isProduction: true });
    const res = await request(app).get('/whoami');
    const cookie = setCookies(res).find((c) => c.startsWith('__Host-inv.pid='));
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
  });
});
