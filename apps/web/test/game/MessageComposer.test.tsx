import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MessageComposer } from '@/components/game/MessageComposer';

function Harness({ onSend, disabled = false }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('');
  return <MessageComposer value={value} onChange={setValue} disabled={disabled} onSend={onSend} />;
}

describe('MessageComposer', () => {
  it('disables sending for whitespace only', async () => {
    render(<Harness onSend={() => {}} />);
    await userEvent.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('sends the trimmed text on Enter', async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await userEvent.type(screen.getByRole('textbox'), '  20% and we sign today. {Enter}');
    expect(onSend).toHaveBeenCalledWith('20% and we sign today.');
  });

  it('adds a line on Shift+Enter', async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'First{Shift>}{Enter}{/Shift}Second');
    expect(box).toHaveValue('First\nSecond');
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSend).toHaveBeenCalledWith('First\nSecond');
  });

  it('is disabled while a turn runs', () => {
    render(<Harness onSend={() => {}} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
});
