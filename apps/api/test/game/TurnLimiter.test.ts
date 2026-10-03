import { describe, expect, it } from 'vitest';
import type { InvestorAction } from '../../src/game/InvestorAction.js';
import { TurnLimiter } from '../../src/game/TurnLimiter.js';

const limiter = new TurnLimiter(15);
const offer = { investment: 500_000, equity: 24 };
const counter: InvestorAction = { kind: 'counter', offer };
const accept: InvestorAction = { kind: 'accept', offer };
const walkAway: InvestorAction = { kind: 'walk_away', reason: 'decided' };

describe('TurnLimiter.statusAfter', () => {
  it.each<[string, Parameters<TurnLimiter['statusAfter']>[0], string]>([
    ['player accepts', { playerMove: 'accept', turn: 3 }, 'deal'],
    ['player declines', { playerMove: 'decline', turn: 3 }, 'rejected_by_player'],
    ['investor accepts', { playerMove: 'other', action: accept, turn: 3 }, 'deal'],
    ['investor walks away', { playerMove: 'other', action: walkAway, turn: 3 }, 'walked_away'],
    ['counter on the last turn', { playerMove: 'other', action: counter, turn: 15 }, 'out_of_turns'],
    ['investor accepts on the last turn', { playerMove: 'other', action: accept, turn: 15 }, 'deal'],
    ['walk-away on the last turn', { playerMove: 'other', action: walkAway, turn: 15 }, 'walked_away'],
    ['player accepts on the last turn', { playerMove: 'accept', turn: 15 }, 'deal'],
    ['counter mid-game', { playerMove: 'other', action: counter, turn: 3 }, 'negotiating'],
  ])('%s', (_name, input, status) => {
    expect(limiter.statusAfter(input)).toBe(status);
  });
});

describe('TurnLimiter.turnsLeft', () => {
  it('counts down and never goes negative', () => {
    expect([
      limiter.turnsLeft(0),
      limiter.turnsLeft(14),
      limiter.turnsLeft(15),
      limiter.turnsLeft(20),
    ]).toEqual([15, 1, 0, 0]);
  });
});
