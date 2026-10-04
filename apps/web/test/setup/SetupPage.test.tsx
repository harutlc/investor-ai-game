import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/api/ApiClientError';
import { renderRoute } from '../support/render';
import { ANGEL, GAME_ID, session, SHARK, summary } from '../support/fixtures';
import { stubApi } from '../support/stubApi';

function api(games = [summary()]) {
  const stub = stubApi();
  stub.listPersonas.mockResolvedValue({ personas: [SHARK, ANGEL] });
  stub.listGames.mockResolvedValue({ games });
  stub.getGame.mockResolvedValue(session());
  return stub;
}

describe('SetupPage', () => {
  it('starts a game with the selected persona and pitch, then opens it', async () => {
    const stub = api([]);
    stub.startGame.mockResolvedValue(session({ persona: ANGEL }));
    const { router } = renderRoute('/', stub);

    await userEvent.click(await screen.findByRole('button', { name: /Grace Okafor/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start negotiation with Grace Okafor' }));

    expect(stub.startGame).toHaveBeenCalledWith({
      personaId: 'generous-angel',
      pitch: {
        name: 'GreenCharge',
        sector: 'EV charging',
        description: 'Fast EV chargers for apartment buildings. €18k monthly revenue, growing 12% a month.',
        valuation: 2_000_000,
        askAmount: 500_000,
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/games/${GAME_ID}`));
  });

  it('shows a toast and keeps the form when the investor is unavailable', async () => {
    const stub = api([]);
    stub.startGame.mockRejectedValue(
      new ApiClientError({ code: 'PROVIDER_UNAVAILABLE', message: 'down', status: 503 }),
    );
    const { router } = renderRoute('/', stub);
    await userEvent.clear(await screen.findByLabelText('Startup name'));
    await userEvent.type(screen.getByLabelText('Startup name'), 'VoltNest');

    await userEvent.click(await screen.findByRole('button', { name: 'Start negotiation with Rex Calloway' }));

    expect(await screen.findByText(/The investor is unavailable right now/)).toBeInTheDocument();
    expect(screen.getByLabelText('Startup name')).toHaveValue('VoltNest');
    expect(router.state.location.pathname).toBe('/');
  });

  it('lists earlier games and hides the list for a new player', async () => {
    renderRoute('/', api());
    const link = await screen.findByRole('link', { name: /GreenCharge/ });
    expect(link).toHaveAttribute('href', `/games/${GAME_ID}`);
    expect(link).toHaveTextContent('turn 2 / 15');
    expect(link).toHaveTextContent('€500k for 26%');
  });

  it('has no "Your games" section without games', async () => {
    renderRoute('/', api([]));
    await screen.findByRole('button', { name: /^Rex Calloway/ });
    expect(screen.queryByRole('heading', { name: 'Your games' })).not.toBeInTheDocument();
  });
});
