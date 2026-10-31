import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/Database.js';
import { MessageRepository } from '../../src/repositories/MessageRepository.js';
import { T0, seedSession } from '../support/gameFixtures.js';
import { dialectsUnderTest, openTestDatabase } from '../support/testDatabase.js';

let database: Database;
let repository: MessageRepository;

const message = (sessionId: string, text: string, createdAt = T0) => ({
  id: randomUUID(),
  sessionId,
  role: 'player' as const,
  text,
  createdAt,
});

describe.each(dialectsUnderTest())('MessageRepository (%s)', (dialect) => {
  beforeEach(async () => {
    database = await openTestDatabase(dialect);
    repository = new MessageRepository(database);
  });
  afterEach(() => database.close());

  it('lists same-millisecond messages in insertion order', async () => {
    const session = await seedSession(database);
    for (const text of ['one', 'two', 'three']) await repository.add(message(session.id, text));
    expect((await repository.listForSession(session.id)).map((m) => m.text)).toEqual(['one', 'two', 'three']);
  });

  it('orders by creation time first', async () => {
    const session = await seedSession(database);
    await repository.add(message(session.id, 'later', new Date(T0.getTime() + 1000)));
    await repository.add(message(session.id, 'earlier'));
    expect((await repository.listForSession(session.id)).map((m) => m.text)).toEqual(['earlier', 'later']);
  });

  it('round-trips every field', async () => {
    const session = await seedSession(database);
    const stored = await repository.add({ ...message(session.id, 'hi'), role: 'investor' });
    expect(await repository.listForSession(session.id)).toEqual([stored]);
  });

  it('only lists the given session', async () => {
    const a = await seedSession(database);
    const b = await seedSession(database);
    await repository.add(message(a.id, 'for a'));
    expect(await repository.listForSession(b.id)).toEqual([]);
  });

  it('refuses a message for an unknown session', async () => {
    await expect(repository.add(message(randomUUID(), 'orphan'))).rejects.toThrow();
  });
});
