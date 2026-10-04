import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '../support/render';
import { GAME_ID, session, SHARK } from '../support/fixtures';
import { stubApi } from '../support/stubApi';

function api() {
  const stub = stubApi();
  stub.listPersonas.mockResolvedValue({ personas: [SHARK] });
  stub.listGames.mockResolvedValue({ games: [] });
  stub.getGame.mockResolvedValue(session());
  return stub;
}

function steps() {
  return within(screen.getByRole('navigation', { name: 'Game steps' })).getAllByRole('listitem');
}

describe('app shell', () => {
  it('shows "Page not found" for an unknown path', async () => {
    renderRoute('/nowhere', api());
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a new game' })).toHaveAttribute('href', '/');
  });

  it('highlights Setup on the setup screen', async () => {
    renderRoute('/', api());
    await screen.findByRole('heading', { name: /Pitch your startup/ });
    expect(steps()[0]).toHaveAttribute('aria-current', 'step');
  });

  it('highlights Negotiation on a game and marks Setup done', () => {
    renderRoute(`/games/${GAME_ID}`, api());
    const [setup, negotiation, debrief] = steps();
    expect(negotiation).toHaveAttribute('aria-current', 'step');
    expect(setup).toHaveTextContent('(done)');
    expect(debrief).not.toHaveAttribute('aria-current');
  });

  it('has a New game link and a theme toggle', () => {
    renderRoute('/', api());
    expect(screen.getByRole('link', { name: 'New game' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: /Switch to (dark|light) theme/ })).toBeInTheDocument();
  });
});
