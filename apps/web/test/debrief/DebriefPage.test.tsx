import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GameSessionDto } from '@investor/shared';
import { renderRoute } from '../support/render';
import { GAME_ID, offer, session } from '../support/fixtures';
import { stubApi } from '../support/stubApi';

function api(game: GameSessionDto) {
  const stub = stubApi();
  stub.getGame.mockResolvedValue(game);
  stub.getInsights.mockResolvedValue({ entries: [] });
  return stub;
}

const finished: Partial<GameSessionDto> = { phase: 'finished', options: [] };

describe('DebriefPage', () => {
  it('shows a deal with its final terms in full euros', async () => {
    const game = session({
      ...finished,
      status: 'deal',
      turn: 4,
      currentInvestorOffer: offer(550_000, 22, 'investor', 4),
    });
    renderRoute(`/games/${GAME_ID}/debrief`, api(game));

    expect(await screen.findByText('Deal closed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('€550k for 22%');
    expect(screen.getByText(/4 of 15 turns used\./)).toBeInTheDocument();
    for (const value of ['€550,000', '22%', '€2,500,000', '€1,950,000']) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Play again' })).toHaveAttribute('href', '/');
  });

  it('shows who ended a game without a deal', async () => {
    const game = session({
      ...finished,
      status: 'walked_away',
      turn: 3,
      currentInvestorOffer: offer(500_000, 26),
    });
    renderRoute(`/games/${GAME_ID}/debrief`, api(game));

    expect(await screen.findByText('No deal')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Rex walked away');
    expect(screen.getByText('€500k for 26%')).toBeInTheDocument();
  });

  it('never reveals the hidden numbers', async () => {
    const game = session({
      ...finished,
      status: 'deal',
      currentInvestorOffer: offer(500_000, 25, 'investor', 2),
    });
    const { container } = renderRoute(`/games/${GAME_ID}/debrief`, api(game));
    await screen.findByText('Deal closed');
    expect(container.textContent).not.toMatch(/budget|equity range|patience|€600/i);
  });

  it('redirects a game that is still negotiating', async () => {
    const { router } = renderRoute(`/games/${GAME_ID}/debrief`, api(session()));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/games/${GAME_ID}`));
    expect(await screen.findByRole('log')).toBeInTheDocument();
  });
});
