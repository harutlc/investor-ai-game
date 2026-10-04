import type { OfferInput } from '@investor/shared';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { ValuationPreview } from '@/lib/ValuationPreview';

interface CustomOfferFormProps {
  initial: OfferInput;
  startupName: string;
  /** The founder's asked pre-money valuation, for the comparison line. */
  askedValuation: number;
  disabled: boolean;
  onSubmit: (offer: OfferInput) => void;
}

/** "€X for Y%": an amount, an equity slider and a live preview of the valuation the offer implies. */
export function CustomOfferForm({
  initial,
  startupName,
  askedValuation,
  disabled,
  onSubmit,
}: CustomOfferFormProps) {
  const id = useId();
  const [amount, setAmount] = useState(String(initial.investment));
  const [equity, setEquity] = useState(ValuationPreview.toSliderValue(initial.equity));

  const investment = amount.trim() === '' ? Number.NaN : Number(amount);
  const validAmount = ValuationPreview.isValidAmount(investment);
  const preview = ValuationPreview.forOffer(investment, equity, askedValuation);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && validAmount && preview) onSubmit({ investment, equity });
  };

  return (
    // noValidate: the form validates with the shared rules; native step checks would block valid amounts.
    <form noValidate onSubmit={submit} className="flex flex-wrap items-end gap-[18px]">
      <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-1.5">
        <label htmlFor={`${id}-amount`} className="text-[13px] font-semibold">
          Investment (€)
        </label>
        <Input
          id={`${id}-amount`}
          type="number"
          inputMode="numeric"
          // Step base 0, so the arrows move in €10k steps from round numbers.
          min={0}
          step={10_000}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={disabled}
          aria-invalid={!validAmount}
          aria-describedby={validAmount ? undefined : `${id}-amount-error`}
          className="h-11 bg-card font-mono text-[15px]"
        />
        {!validAmount && (
          <span id={`${id}-amount-error`} className="text-xs text-destructive">
            Enter a whole number of euros above 0.
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-[2_1_260px] flex-col gap-1.5">
        <span id={`${id}-equity`} className="text-[13px] font-semibold">
          Equity: <span className="font-mono font-medium">{equity}%</span>
        </span>
        <div className="flex h-11 items-center">
          <Slider
            aria-labelledby={`${id}-equity`}
            min={ValuationPreview.MIN_EQUITY}
            max={ValuationPreview.MAX_EQUITY}
            step={ValuationPreview.EQUITY_STEP}
            value={[equity]}
            onValueChange={(values) => setEquity(values[0] ?? equity)}
            disabled={disabled}
            className="[&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-track]]:h-1.5"
          />
        </div>
      </div>

      <output
        htmlFor={`${id}-amount`}
        aria-live="polite"
        className="flex min-w-0 flex-[2_1_260px] flex-col gap-0.5 rounded-[10px] bg-secondary px-3.5 py-2.5 text-[13px]"
      >
        <span className="text-muted-foreground">Your offer values {startupName} at</span>
        <span className="font-mono text-base">{preview?.valuationText ?? '—'}</span>
        {preview && (
          <span className={cn(preview.direction === 'below' ? 'text-destructive' : 'text-accent-foreground')}>
            {preview.versusAsk}
          </span>
        )}
      </output>

      <Button
        type="submit"
        disabled={disabled || !validAmount || !preview}
        className="h-[46px] rounded-[10px] px-5 text-[15px] font-semibold"
      >
        Send offer
      </Button>
    </form>
  );
}
