import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatPanel } from '@/components/game/ChatPanel';
import { message, SHARK } from '../support/fixtures';

const messages = [
  message('system', 'Negotiation started with Rex Calloway.'),
  message('investor', "Here's my number: €500k for 30%."),
  message('player', '€500k for 15%.'),
];

describe('ChatPanel', () => {
  it('renders the transcript in order in a live log', () => {
    render(<ChatPanel persona={SHARK} status="negotiating" messages={messages} pendingText={null} />);
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveTextContent(
      /Negotiation started with Rex Calloway\.\s*RCRex Calloway: Here's my number: €500k for 30%\.\s*You: €500k for 15%\./,
    );
    expect(screen.getByText('Negotiating')).toBeInTheDocument();
    expect(screen.queryByText(/is typing/)).not.toBeInTheDocument();
  });

  it('shows the pending move and a typing indicator with the first name', () => {
    render(
      <ChatPanel persona={SHARK} status="negotiating" messages={messages} pendingText="€500k for 20%." />,
    );
    const log = screen.getByRole('log');
    expect(within(log).getByText('Rex is typing…')).toBeInTheDocument();
    expect(log.querySelector('[data-pending]')).toHaveTextContent('You (sending): €500k for 20%.');
  });

  it('shows the end status in the pill', () => {
    render(<ChatPanel persona={SHARK} status="walked_away" messages={messages} pendingText={null} />);
    expect(screen.getByText('Investor walked away')).toBeInTheDocument();
  });
});
