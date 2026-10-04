import { GameStatusSchema } from '@investor/shared';
import { describe, expect, it } from 'vitest';
import { StatusText } from '@/lib/StatusText';

describe('StatusText', () => {
  it('labels every status', () => {
    expect(GameStatusSchema.options.map((status) => StatusText.pill(status).label)).toEqual([
      'Negotiating',
      'Deal',
      'Investor walked away',
      'You walked away',
      'Out of turns',
    ]);
  });

  it('words the end of a game', () => {
    expect(StatusText.endBanner('deal')).toBe('The deal is done.');
    expect(StatusText.endBanner('out_of_turns')).toBe('The negotiation is over.');
    expect(StatusText.outcome('deal')).toBe('Deal closed');
    expect(StatusText.outcome('walked_away')).toBe('No deal');
    expect(StatusText.noDealHeadline('walked_away', 'Rex')).toBe('Rex walked away');
    expect(StatusText.noDealHeadline('rejected_by_player', 'Rex')).toBe('You walked away');
    expect(StatusText.noDealHeadline('out_of_turns', 'Rex')).toBe('Out of turns');
  });
});
