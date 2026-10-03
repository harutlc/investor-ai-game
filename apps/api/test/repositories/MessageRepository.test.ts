import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database.js';
import { MessageRepository } from '../../src/repositories/MessageRepository.js';
import { T0, seedSession } from '../support/gameFixtures.js';

let database: Database;
let repository: MessageRepository;

beforeEach(() => {
  database = new Database(':memory:');
  repository = new MessageRepository(database.db);
});
afterEach(() => database.close());

const message = (sessionId: string, text: string, createdAt = T0) => ({
  id: randomUUID(),
  sessionId,
  role: 'player' as const,
  text,
  createdAt,
});

describe('MessageRepository', () => {
  it('lists same-millisecond messages in insertion order', () => {
    const session = seedSession(database);
    for (const text of ['one', 'two', 'three']) repository.add(message(session.id, text));
    expect(repository.listForSession(session.id).map((m) => m.text)).toEqual(['one', 'two', 'three']);
  });

  it('orders by creation time first', () => {
    const session = seedSession(database);
    repository.add(message(session.id, 'later', new Date(T0.getTime() + 1000)));
    repository.add(message(session.id, 'earlier'));
    expect(repository.listForSession(session.id).map((m) => m.text)).toEqual(['earlier', 'later']);
  });

  it('round-trips every field', () => {
    const session = seedSession(database);
    const stored = repository.add({ ...message(session.id, 'hi'), role: 'investor' });
    expect(repository.listForSession(session.id)).toEqual([stored]);
  });

  it('only lists the given session', () => {
    const a = seedSession(database);
    const b = seedSession(database);
    repository.add(message(a.id, 'for a'));
    expect(repository.listForSession(b.id)).toEqual([]);
  });

  it('refuses a message for an unknown session', () => {
    expect(() => repository.add(message(randomUUID(), 'orphan'))).toThrow();
  });
});
