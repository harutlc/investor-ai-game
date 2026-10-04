import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PitchForm } from '@/components/setup/PitchForm';
import { PitchValidator, type PitchDraft } from '@/lib/PitchValidator';

function Harness() {
  const [draft, setDraft] = useState<PitchDraft>(PitchValidator.DEFAULT_DRAFT);
  const { errors, pitch } = PitchValidator.validate(draft);
  return (
    <>
      <PitchForm value={draft} errors={errors} onChange={setDraft} />
      <button type="button" disabled={!pitch}>
        Start
      </button>
    </>
  );
}

describe('PitchForm', () => {
  it('prefills GreenCharge and shows the valuation hints', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Startup name')).toHaveValue('GreenCharge');
    expect(screen.getByText('€2M before the investment')).toBeInTheDocument();
    expect(screen.getByText('€500k for 20% at your valuation')).toBeInTheDocument();
  });

  it('flags a cleared ask and blocks the start', async () => {
    render(<Harness />);
    const ask = screen.getByLabelText('Ask amount (€)');
    await userEvent.clear(ask);

    expect(ask).toHaveAttribute('aria-invalid', 'true');
    expect(ask).toHaveAccessibleDescription('Enter a whole number of euros above 0.');
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('rejects a zero ask and an empty name', async () => {
    render(<Harness />);
    await userEvent.clear(screen.getByLabelText('Ask amount (€)'));
    await userEvent.type(screen.getByLabelText('Ask amount (€)'), '0');
    await userEvent.clear(screen.getByLabelText('Startup name'));

    expect(screen.getByLabelText('Startup name')).toHaveAccessibleDescription(
      "Enter your startup's name (up to 80 characters).",
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });
});

describe('PitchValidator.fromServerDetails', () => {
  it('maps API validation details onto fields', () => {
    expect(
      PitchValidator.fromServerDetails([
        { path: 'body.pitch.askAmount', message: 'Too small' },
        { path: 'body.personaId', message: 'Unknown persona' },
      ]),
    ).toEqual({ askAmount: 'Enter a whole number of euros above 0. (Too small)' });
  });
});
