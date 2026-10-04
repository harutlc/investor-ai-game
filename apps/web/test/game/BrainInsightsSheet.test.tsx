import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BrainInsightsSheet } from '@/components/game/BrainInsightsSheet';
import { INSIGHTS } from '../support/fixtures';

const base = { loading: false, error: null, onRetry: () => {} };

describe('BrainInsightsSheet', () => {
  it('summarises the calls and lists entries newest first', async () => {
    render(<BrainInsightsSheet {...base} insights={INSIGHTS} />);
    const trigger = screen.getByRole('button', { name: /Brain insights/ });
    expect(trigger).toHaveTextContent('2 decision calls · latest turn 2');

    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Brain insights' });
    const articles = within(dialog).getAllByRole('article');
    expect(articles[0]).toHaveTextContent('Stage A');
    expect(articles[0]).toHaveTextContent('Failed: PROVIDER_UNAVAILABLE');
    expect(articles[1]).toHaveTextContent('Stage BTurn 1laya · english · 412 ms');

    const rows = within(articles[1]!).getAllByTestId('answer-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'acceptscore82%Probably reject · 1.1',
      'reactionchoiceuncertain49%counter',
      'good_dealnoul69%p = 0.31',
    ]);
  });

  it('explains an empty log', async () => {
    render(<BrainInsightsSheet {...base} insights={{ entries: [] }} />);
    const trigger = screen.getByRole('button', { name: /No decision calls yet/ });
    await userEvent.click(trigger);
    expect(screen.getByText(/The opening offer is computed by code/)).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the button', async () => {
    render(<BrainInsightsSheet {...base} insights={INSIGHTS} />);
    const trigger = screen.getByRole('button', { name: /Brain insights/ });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
