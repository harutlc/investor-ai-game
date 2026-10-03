import { describe, expect, it } from 'vitest';
import { TurnInProgressError } from '../../src/errors/TurnInProgressError.js';
import { TurnLock } from '../../src/game/TurnLock.js';

describe('TurnLock', () => {
  it('rejects a second turn for the same game until released', () => {
    const lock = new TurnLock();
    lock.acquire('game-1');
    expect(() => lock.acquire('game-1')).toThrow(TurnInProgressError);
    lock.release('game-1');
    expect(() => lock.acquire('game-1')).not.toThrow();
  });

  it('does not block other games', () => {
    const lock = new TurnLock();
    lock.acquire('game-1');
    expect(() => lock.acquire('game-2')).not.toThrow();
  });
});
