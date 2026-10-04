import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlayerOptions } from '@/components/game/PlayerOptions';
import { OPTIONS } from '../support/fixtures';

describe('PlayerOptions', () => {
  it('labels every option with its kind', () => {
    render(<PlayerOptions options={OPTIONS} disabled={false} onPick={() => {}} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'CounterCounter: €500k for 15%',
      'AskAsk why 30%',
      'AcceptAccept €500k for 30%',
      'DeclineWalk away',
    ]);
  });

  it('reports the picked option', async () => {
    const onPick = vi.fn();
    render(<PlayerOptions options={OPTIONS} disabled={false} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: /Accept €500k for 30%/ }));
    expect(onPick).toHaveBeenCalledWith(OPTIONS[2]);
  });

  it('disables every option while a turn runs', async () => {
    const onPick = vi.fn();
    render(<PlayerOptions options={OPTIONS} disabled onPick={onPick} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Walk away/ }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
