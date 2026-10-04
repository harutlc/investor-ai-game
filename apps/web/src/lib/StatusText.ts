import type { GameStatus } from '@investor/shared';

export type StatusTone = 'info' | 'success' | 'danger' | 'neutral';

/** The words a game status is shown with: the pill, the end banner and the debrief headline. */
export class StatusText {
  private static readonly PILLS: Record<GameStatus, { label: string; tone: StatusTone }> = {
    negotiating: { label: 'Negotiating', tone: 'info' },
    deal: { label: 'Deal', tone: 'success' },
    walked_away: { label: 'Investor walked away', tone: 'danger' },
    rejected_by_player: { label: 'You walked away', tone: 'neutral' },
    out_of_turns: { label: 'Out of turns', tone: 'neutral' },
  };

  static pill(status: GameStatus): { label: string; tone: StatusTone } {
    return StatusText.PILLS[status];
  }

  static endBanner(status: GameStatus): string {
    return status === 'deal' ? 'The deal is done.' : 'The negotiation is over.';
  }

  static outcome(status: GameStatus): string {
    return status === 'deal' ? 'Deal closed' : 'No deal';
  }

  /** The headline of a finished game that ended without a deal. */
  static noDealHeadline(status: GameStatus, investorFirstName: string): string {
    switch (status) {
      case 'walked_away':
        return `${investorFirstName} walked away`;
      case 'rejected_by_player':
        return 'You walked away';
      case 'out_of_turns':
        return 'Out of turns';
      default:
        return 'No deal';
    }
  }
}
