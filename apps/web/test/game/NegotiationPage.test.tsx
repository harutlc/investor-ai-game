import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TurnResultDto } from '@investor/shared';
import { ApiClientError } from '@/api/ApiClientError';
import { renderRoute } from '../support/render';
import { GAME_ID, INSIGHTS, session, turnResult } from '../support/fixtures';
import { stubApi } from '../support/stubApi';

function api(game = session()) {
  const stub = stubApi();
  stub.getGame.mockResolvedValue(game);
  stub.getInsights.mockResolvedValue({ entries: [] });
  stub.listGames.mockResolvedValue({ games: [] });
  return stub;
}

describe('NegotiationPage', () => {
  it('shows the opening: transcript, offer, meters and options', async () => {
    renderRoute(`/games/${GAME_ID}`, api());
    expect(await screen.findByRole('log')).toHaveTextContent("Here's my number");
    expect(screen.getByText('Turn 0 / 15')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How Rex seems' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Options', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Counter: €500k for 15%/ })).toBeEnabled();
    expect(await screen.findByText('No decision calls yet')).toBeInTheDocument();
  });

  it('plays an offer: pending bubble and disabled inputs, then the new session', async () => {
    const stub = api();
    let resolve!: (result: TurnResultDto) => void;
    stub.playTurn.mockReturnValue(new Promise((done) => (resolve = done)));
    renderRoute(`/games/${GAME_ID}`, stub);

    await userEvent.click(await screen.findByRole('tab', { name: 'Make an offer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send offer' }));

    expect(stub.playTurn).toHaveBeenCalledWith(GAME_ID, { offer: { investment: 500_000, equity: 20 } });
    const log = screen.getByRole('log');
    expect(within(log).getByText('Rex is typing…')).toBeInTheDocument();
    expect(log.querySelector('[data-pending]')).toHaveTextContent('€500k for 20%.');
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();

    stub.getInsights.mockResolvedValue(INSIGHTS);
    resolve(turnResult());
    await waitFor(() => expect(screen.queryByText('Rex is typing…')).not.toBeInTheDocument());
    expect(log).toHaveTextContent("I'll come down to 26%.");
    expect(screen.getByText('Gap: 6 equity points, €0 in amount')).toBeInTheDocument();
    expect(await screen.findByText('2 decision calls · latest turn 2')).toBeInTheDocument();
  });

  it('shows a toast, drops the pending bubble and keeps the draft when a turn fails', async () => {
    const stub = api();
    stub.playTurn.mockRejectedValue(
      new ApiClientError({ code: 'TURN_IN_PROGRESS', message: 'busy', status: 409 }),
    );
    renderRoute(`/games/${GAME_ID}`, stub);

    await userEvent.click(await screen.findByRole('tab', { name: 'Write a message' }));
    await userEvent.type(screen.getByRole('textbox'), '20% and we sign today.{Enter}');

    expect(await screen.findByText(/Your previous move is still being processed/)).toBeInTheDocument();
    expect(screen.getByRole('log').querySelector('[data-pending]')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('20% and we sign today.');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('clears the draft after a message turn succeeds', async () => {
    const stub = api();
    stub.playTurn.mockResolvedValue(turnResult());
    renderRoute(`/games/${GAME_ID}`, stub);

    await userEvent.click(await screen.findByRole('tab', { name: 'Write a message' }));
    await userEvent.type(screen.getByRole('textbox'), 'Hello{Enter}');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(stub.playTurn).toHaveBeenCalledWith(GAME_ID, { message: 'Hello' });
  });

  it('replaces the inputs with the end banner when the game is over', async () => {
    renderRoute(`/games/${GAME_ID}`, api(session({ status: 'deal', phase: 'finished', options: [] })));
    expect(await screen.findByText('The deal is done.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the debrief' })).toHaveAttribute(
      'href',
      `/games/${GAME_ID}/debrief`,
    );
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByText('Deal')).toBeInTheDocument();
  });

  it('says "Game not found" for a 404', async () => {
    const stub = stubApi();
    stub.getGame.mockRejectedValue(new ApiClientError({ code: 'NOT_FOUND', message: 'nope', status: 404 }));
    renderRoute(`/games/${GAME_ID}`, stub);
    expect(await screen.findByRole('heading', { name: 'Game not found' })).toBeInTheDocument();
  });

  it('offers a retry for other load failures', async () => {
    const stub = stubApi();
    stub.getGame.mockRejectedValueOnce(
      new ApiClientError({ code: 'NETWORK_ERROR', message: 'down', status: null }),
    );
    stub.getGame.mockResolvedValue(session());
    stub.getInsights.mockResolvedValue({ entries: [] });
    renderRoute(`/games/${GAME_ID}`, stub);

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('log')).toBeInTheDocument();
  });
});
