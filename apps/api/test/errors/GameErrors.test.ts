import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/AppError.js';
import { GameAlreadyFinishedError } from '../../src/errors/GameAlreadyFinishedError.js';
import { GameNotFoundError } from '../../src/errors/GameNotFoundError.js';
import { InvalidMoveError } from '../../src/errors/InvalidMoveError.js';
import { TurnInProgressError } from '../../src/errors/TurnInProgressError.js';

describe('game errors', () => {
  it.each<[string, AppError, number, string]>([
    ['GameNotFoundError', new GameNotFoundError(), 404, 'NOT_FOUND'],
    ['GameAlreadyFinishedError', new GameAlreadyFinishedError(), 409, 'GAME_FINISHED'],
    ['InvalidMoveError', new InvalidMoveError('Unknown option'), 422, 'INVALID_MOVE'],
    ['TurnInProgressError', new TurnInProgressError(), 409, 'TURN_IN_PROGRESS'],
  ])('%s maps to %s %s', (name, error, status, code) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe(name);
    expect([error.status, error.code]).toEqual([status, code]);
  });

  it('keeps a custom invalid-move message', () => {
    expect(new InvalidMoveError('Unknown option').message).toBe('Unknown option');
  });
});
