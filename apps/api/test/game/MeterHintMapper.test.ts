import { InvestorMetersSchema } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { MeterHintMapper } from '../../src/game/MeterHintMapper.js';

const mapper = new MeterHintMapper();

describe('MeterHintMapper', () => {
  it('maps interest 0.72 and patience 2 to high / Tapping the table', () => {
    expect(mapper.toMeters({ interest: 0.72, patience: 2 })).toEqual({
      interestLevel: 'high',
      patienceHint: 'Tapping the table',
    });
  });

  it.each([
    [0, 'low'],
    [0.3499, 'low'],
    [0.35, 'medium'],
    [0.6499, 'medium'],
    [0.65, 'high'],
    [1, 'high'],
  ])('maps interest %s to %s', (interest, level) => {
    expect(mapper.toMeters({ interest, patience: 3 }).interestLevel).toBe(level);
  });

  it.each([
    [0, 'Out of patience'],
    [1, 'Checking the time'],
    [2, 'Tapping the table'],
    [3, 'Getting restless'],
    [4, 'Listening patiently'],
    [7, 'Listening patiently'],
  ])('maps patience %s to "%s"', (patience, hint) => {
    expect(mapper.toMeters({ interest: 0.5, patience }).patienceHint).toBe(hint);
  });

  it('produces valid public meters with no numbers in them', () => {
    for (let patience = 0; patience <= 7; patience++) {
      for (const interest of [0, 0.4, 0.9]) {
        const meters = mapper.toMeters({ interest, patience });
        expect(InvestorMetersSchema.safeParse(meters).success).toBe(true);
        expect(JSON.stringify(meters)).not.toMatch(/\d/);
        expect('trustHint' in meters).toBe(false);
      }
    }
  });
});
