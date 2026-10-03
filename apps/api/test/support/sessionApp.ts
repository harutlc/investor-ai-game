import cookieParser from 'cookie-parser';
import { Router } from 'express';
import { Database } from '../../src/db/Database.js';
import { CsrfProtection } from '../../src/http/middleware/CsrfProtection.js';
import { PlayerSessionMiddleware } from '../../src/http/middleware/PlayerSessionMiddleware.js';
import { PlayerRepository } from '../../src/repositories/PlayerRepository.js';
import { PlayerService } from '../../src/services/PlayerService.js';
import { miniApp } from './miniApp.js';
import { testConfig } from './testConfig.js';

/** Mini app with cookie parsing, the player session and CSRF protection around a few test routes. */
export function sessionApp(options: { isProduction?: boolean } = {}) {
  const config = testConfig({ nodeEnv: options.isProduction ? 'production' : 'test' });
  const database = new Database(':memory:');
  const players = new PlayerRepository(database.db);
  const session = new PlayerSessionMiddleware(config, new PlayerService(players));
  const csrf = new CsrfProtection(config);

  const router = Router()
    .get('/whoami', (req, res) => res.json({ playerId: req.player?.id }))
    .get('/csrf-token', (req, res) => res.json({ csrfToken: csrf.issueToken(req, res) }))
    .post('/mutate', (_req, res) => res.json({ ok: true }));

  const app = miniApp(router, {
    isProduction: options.isProduction ?? false,
    before: [cookieParser(config.secrets.cookieSecret), session.handle, csrf.handle],
  });
  return { app, database, players, session, csrf };
}
