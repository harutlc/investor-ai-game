import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { sessionApp } from '../support/sessionApp.js';

async function sessionWithToken(app: ReturnType<typeof sessionApp>['app']) {
  const agent = request.agent(app);
  const res = await agent.get('/csrf-token');
  return { agent, token: res.body.csrfToken as string };
}

describe('CsrfProtection', () => {
  it('accepts a POST with the session token', async () => {
    const { app } = sessionApp();
    const { agent, token } = await sessionWithToken(app);
    const res = await agent.post('/mutate').set('X-CSRF-Token', token).send({});
    expect(res.status).toBe(200);
  });

  it('rejects a POST without a token', async () => {
    const { app } = sessionApp();
    const { agent } = await sessionWithToken(app);
    const res = await agent.post('/mutate').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a token that does not match the cookie', async () => {
    const { app } = sessionApp();
    const { agent, token } = await sessionWithToken(app);
    const res = await agent.post('/mutate').set('X-CSRF-Token', `${token}x`).send({});
    expect(res.status).toBe(403);
  });

  it("rejects a token pair minted for another player's session", async () => {
    const { app } = sessionApp();
    const cookieOf = (res: request.Response, name: string) =>
      (res.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith(`${name}=`))!
        .split(';')[0]!;

    const attackerRes = await request(app).get('/csrf-token');
    const attackerToken = attackerRes.body.csrfToken as string;
    const attackerCsrf = cookieOf(attackerRes, 'inv.csrf');
    const attackerSession = cookieOf(attackerRes, 'inv.pid');
    const victimSession = cookieOf(await request(app).get('/whoami'), 'inv.pid');

    // Control: the pair works with the session it was minted for.
    const own = await request(app)
      .post('/mutate')
      .set('Cookie', `${attackerSession}; ${attackerCsrf}`)
      .set('X-CSRF-Token', attackerToken)
      .send({});
    expect(own.status).toBe(200);

    // Same pair planted next to the victim's session cookie: the HMAC is bound to the attacker's id.
    const planted = await request(app)
      .post('/mutate')
      .set('Cookie', `${victimSession}; ${attackerCsrf}`)
      .set('X-CSRF-Token', attackerToken)
      .send({});
    expect(planted.status).toBe(403);
    expect(planted.body.error.code).toBe('CSRF_INVALID');
  });

  it('does not require a token for GET', async () => {
    const { app } = sessionApp();
    expect((await request(app).get('/whoami')).status).toBe(200);
  });

  it('reuses a still-valid token for the same session', async () => {
    const { app } = sessionApp();
    const { agent, token } = await sessionWithToken(app);
    expect((await agent.get('/csrf-token')).body.csrfToken).toBe(token);
  });

  it('issues a __Host- prefixed, Secure, HttpOnly cookie in production', async () => {
    const { app } = sessionApp({ isProduction: true });
    const res = await request(app).get('/csrf-token');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('__Host-inv.csrf='),
    );
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
  });
});
