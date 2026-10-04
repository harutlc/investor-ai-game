import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PersonaPicker } from '@/components/setup/PersonaPicker';
import { ANGEL, SHARK } from '../support/fixtures';

const base = { loading: false, error: null, onRetry: () => {}, onSelect: () => {} };

describe('PersonaPicker', () => {
  it('shows every persona with its tagline and traits, one selected', () => {
    render(<PersonaPicker {...base} personas={[SHARK, ANGEL]} selectedId={SHARK.id} />);

    const shark = screen.getByRole('button', { name: /Rex Calloway/ });
    expect(shark).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Grace Okafor/ })).toHaveAttribute('aria-pressed', 'false');
    expect(shark).toHaveTextContent('Wants the biggest slice');
    expect(shark).toHaveTextContent('tough haggler');
    expect(shark).toHaveTextContent('RC');
  });

  it('reports a click', async () => {
    const onSelect = vi.fn();
    render(<PersonaPicker {...base} personas={[SHARK, ANGEL]} selectedId={SHARK.id} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /Grace Okafor/ }));
    expect(onSelect).toHaveBeenCalledWith('generous-angel');
  });

  it('shows skeletons while loading', () => {
    render(<PersonaPicker {...base} personas={undefined} selectedId={null} loading />);
    expect(screen.getAllByTestId('persona-skeleton')).toHaveLength(6);
  });

  it('offers a retry when loading failed', async () => {
    const onRetry = vi.fn();
    render(
      <PersonaPicker
        {...base}
        personas={undefined}
        selectedId={null}
        error="Can't reach the game server."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the game server.");
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
