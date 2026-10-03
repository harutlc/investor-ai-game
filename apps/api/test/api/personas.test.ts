import { PersonaListDtoSchema } from '@investor/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PERSONA_DEFINITIONS } from '../../src/personas/personaDefinitions.js';
import { createTestApp } from '../support/createTestApp.js';

const HIDDEN_KEYS = [
  'budget',
  'minEquity',
  'maxEquity',
  'initialInterest',
  'patience',
  'concessionStep',
  'personality',
  'goals',
  'toneInstructions',
  'numbers',
];

describe('GET /api/personas', () => {
  it('returns the six personas with public fields only', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/personas');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    const body = PersonaListDtoSchema.parse(res.body);
    expect(body.personas.map((persona) => persona.id)).toEqual(PERSONA_DEFINITIONS.map((d) => d.id));
    for (const persona of body.personas) {
      expect(Object.keys(persona).sort()).toEqual(['avatar', 'id', 'name', 'tagline', 'traits']);
    }
  });

  it('leaks no hidden keys or budget values', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/personas');

    for (const key of HIDDEN_KEYS) expect(res.text).not.toContain(`"${key}"`);
    for (const { numbers, personality, toneInstructions } of PERSONA_DEFINITIONS) {
      expect(res.text).not.toContain(String(numbers.budget));
      expect(res.text).not.toContain(personality);
      expect(res.text).not.toContain(toneInstructions);
    }
  });

  it('creates a player session like any other /api endpoint', async () => {
    const { app, players } = createTestApp();
    const res = await request(app).get('/api/personas');
    expect(String(res.headers['set-cookie'])).toContain('inv.pid=');
    expect(players.count()).toBe(1);
  });
});
