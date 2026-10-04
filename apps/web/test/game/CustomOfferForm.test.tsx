import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CustomOfferForm } from '@/components/game/CustomOfferForm';

function renderForm(overrides: Partial<Parameters<typeof CustomOfferForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <CustomOfferForm
      initial={{ investment: 500_000, equity: 20 }}
      startupName="GreenCharge"
      askedValuation={2_000_000}
      disabled={false}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit };
}

describe('CustomOfferForm', () => {
  it('starts from the given offer and previews its valuation', () => {
    renderForm();
    expect(screen.getByLabelText('Investment (€)')).toHaveValue(500_000);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByText('€2.5M post · €2M pre')).toBeInTheDocument();
    expect(screen.getByText('Exactly your asked valuation')).toBeInTheDocument();
  });

  it('updates the preview as the amount and equity change', async () => {
    renderForm();
    const amount = screen.getByLabelText('Investment (€)');
    await userEvent.clear(amount);
    await userEvent.type(amount, '550000');
    expect(screen.getByText('+10% vs your asked €2M')).toBeInTheDocument();

    screen.getByRole('slider').focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText(/Equity:/)).toHaveTextContent('Equity: 21%');
  });

  it('sends { investment, equity }', async () => {
    const { onSubmit } = renderForm({ initial: { investment: 450_000, equity: 17.5 } });
    await userEvent.click(screen.getByRole('button', { name: 'Send offer' }));
    expect(onSubmit).toHaveBeenCalledWith({ investment: 450_000, equity: 17.5 });
  });

  it('disables sending for an invalid amount', async () => {
    const { onSubmit } = renderForm();
    const amount = screen.getByLabelText('Investment (€)');
    await userEvent.clear(amount);
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
    await userEvent.type(amount, '1000.5');
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
    expect(amount).toHaveAccessibleDescription('Enter a whole number of euros above 0.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is disabled while a turn runs', () => {
    renderForm({ disabled: true });
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
    expect(screen.getByLabelText('Investment (€)')).toBeDisabled();
    expect(screen.getByRole('slider')).toHaveAttribute('data-disabled');
  });
});
