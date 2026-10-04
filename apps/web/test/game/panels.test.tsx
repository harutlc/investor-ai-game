import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DealPanel } from '@/components/game/DealPanel';
import { InvestorMeters } from '@/components/game/InvestorMeters';
import { offer, PITCH } from '../support/fixtures';

describe('DealPanel', () => {
  it('shows the turn counter, both offers and the gap', () => {
    render(
      <DealPanel
        turn={2}
        maxTurns={15}
        currentInvestorOffer={offer(500_000, 26, 'investor', 2)}
        lastPlayerOffer={offer(500_000, 20, 'player', 2)}
        pitch={PITCH}
      />,
    );
    expect(screen.getByText('Turn 2 / 15')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Turns used' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText('€500k for 26%')).toBeInTheDocument();
    expect(screen.getByText('€500k for 20%')).toBeInTheDocument();
    expect(screen.getByText('Gap: 6 equity points, €0 in amount')).toBeInTheDocument();
    expect(screen.getByText('You asked €500k at €2M pre-money.')).toBeInTheDocument();
  });

  it('asks for an offer before showing a gap', () => {
    render(
      <DealPanel
        turn={0}
        maxTurns={15}
        currentInvestorOffer={offer(500_000, 30)}
        lastPlayerOffer={null}
        pitch={PITCH}
      />,
    );
    expect(screen.getByText('€1.67M post · €1.17M pre')).toBeInTheDocument();
    expect(screen.getByText('No offer yet')).toBeInTheDocument();
    expect(screen.getByText('Make an offer to see the gap.')).toBeInTheDocument();
  });
});

describe('InvestorMeters', () => {
  it('fills two of three segments for medium interest and has no trust row without a hint', () => {
    const { container } = render(
      <InvestorMeters
        meters={{ interestLevel: 'medium', patienceHint: 'Tapping the table' }}
        firstName="Rex"
      />,
    );
    expect(screen.getByRole('heading', { name: 'How Rex seems' })).toBeInTheDocument();
    const segments = screen.getAllByTestId('interest-segment').map((segment) => segment.dataset.filled);
    expect(segments).toEqual(['true', 'true', 'false']);
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Tapping the table')).toBeInTheDocument();
    expect(screen.queryByText('Trust')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('shows the trust hint when there is one', () => {
    render(
      <InvestorMeters
        meters={{ interestLevel: 'high', patienceHint: 'Smiling', trustHint: 'Warming up' }}
        firstName="Rex"
      />,
    );
    expect(screen.getByText('Trust')).toBeInTheDocument();
    expect(screen.getByText('Warming up')).toBeInTheDocument();
    expect(
      screen.getAllByTestId('interest-segment').every((segment) => segment.dataset.filled === 'true'),
    ).toBe(true);
  });
});
