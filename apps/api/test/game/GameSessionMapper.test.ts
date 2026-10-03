import { randomUUID } from 'node:crypto';
import { DecisionInsightsDtoSchema, GameSessionDtoSchema, type PlayerOption } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { GameSessionMapper } from '../../src/game/GameSessionMapper.js';
import { MeterHintMapper } from '../../src/game/MeterHintMapper.js';
import { InvestorPersona } from '../../src/personas/InvestorPersona.js';
import type { StoredMessage } from '../../src/repositories/MessageRepository.js';
import { T0, sessionFixture } from '../support/gameFixtures.js';
import { definition } from '../support/personaFixtures.js';

const mapper = new GameSessionMapper(new MeterHintMapper(), 15);
const persona = new InvestorPersona(definition);
const options: PlayerOption[] = [{ id: 'opt-1-1', kind: 'decline', label: 'Walk away' }];
const session = sessionFixture('player-1', { playerOptions: options });
const messages: StoredMessage[] = [
  { id: randomUUID(), sessionId: session.id, role: 'system', text: 'Negotiation started.', createdAt: T0 },
  { id: randomUUID(), sessionId: session.id, role: 'investor', text: '€500k for 30%.', createdAt: T0 },
];

describe('GameSessionMapper.toDto', () => {
  it('builds a valid public view with meters, messages and options', () => {
    const dto = mapper.toDto(session, persona, messages, null);
    expect(GameSessionDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto).toMatchObject({
      id: session.id,
      persona: persona.toPublicDto(),
      status: 'negotiating',
      turn: 0,
      maxTurns: 15,
      lastPlayerOffer: null,
      meters: { interestLevel: 'high', patienceHint: 'Getting restless' },
      options,
      createdAt: T0.toISOString(),
    });
    expect(dto.messages.map((message) => [message.role, message.createdAt])).toEqual([
      ['system', T0.toISOString()],
      ['investor', T0.toISOString()],
    ]);
  });

  it('never carries hidden investor numbers', () => {
    const text = JSON.stringify(mapper.toDto(session, persona, messages, null));
    for (const key of ['budget', 'patience', 'interest', 'concessionStep', 'minEquity', 'maxEquity']) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(text).not.toContain('700000');
  });

  it('offers no options once the game has ended', () => {
    expect(mapper.toDto({ ...session, status: 'deal' }, persona, messages, null).options).toEqual([]);
  });
});

describe('GameSessionMapper.toInsights', () => {
  it('maps decision log entries without session ids', () => {
    const insights = mapper.toInsights([
      {
        id: randomUUID(),
        sessionId: session.id,
        turn: 1,
        stage: 'B',
        provider: 'fake',
        model: 'fake',
        questions: { good_deal: { type: 'noul', instructions: 'Attractive?' } },
        answers: { good_deal: { type: 'noul', probability: 0.3 } },
        errorCode: null,
        latencyMs: 12,
        createdAt: T0,
      },
    ]);
    expect(DecisionInsightsDtoSchema.safeParse(insights).success).toBe(true);
    expect(insights.entries[0]).toMatchObject({ turn: 1, stage: 'B', createdAt: T0.toISOString() });
    expect(JSON.stringify(insights)).not.toContain(session.id);
  });
});
