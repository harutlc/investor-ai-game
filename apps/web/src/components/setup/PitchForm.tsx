import { useId, type ChangeEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PitchValidator, type PitchDraft, type PitchErrors, type PitchField } from '@/lib/PitchValidator';
import { ValuationPreview } from '@/lib/ValuationPreview';

interface PitchFormProps {
  value: PitchDraft;
  errors: PitchErrors;
  onChange: (draft: PitchDraft) => void;
  disabled?: boolean;
}

/** The startup pitch: text fields, valuation and ask, with live hints. */
export function PitchForm({ value, errors, onChange, disabled = false }: PitchFormProps) {
  const id = useId();
  const valuation = PitchValidator.toNumber(value.valuation);
  const ask = PitchValidator.toNumber(value.askAmount);
  const set = (field: PitchField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [field]: event.target.value });

  const field = (name: PitchField, label: string, control: React.ReactNode, hint?: string | null) => {
    const error = errors[name];
    return (
      <div className={cn('flex flex-col gap-1.5', name === 'description' && 'col-span-full')}>
        <label htmlFor={`${id}-${name}`} className="text-[13px] font-semibold">
          {label}
        </label>
        {control}
        {error ? (
          <span id={`${id}-${name}-error`} className="text-xs text-destructive">
            {error}
          </span>
        ) : hint ? (
          <span id={`${id}-${name}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    );
  };

  const describedBy = (name: PitchField) => (errors[name] ? `${id}-${name}-error` : `${id}-${name}-hint`);
  const inputClass = 'h-11 bg-card text-[15px]';

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-[18px] rounded-[14px] border bg-card p-[22px]">
      {field(
        'name',
        'Startup name',
        <Input
          id={`${id}-name`}
          className={inputClass}
          value={value.name}
          onChange={set('name')}
          disabled={disabled}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={describedBy('name')}
        />,
      )}
      {field(
        'sector',
        'Sector',
        <Input
          id={`${id}-sector`}
          className={inputClass}
          value={value.sector}
          onChange={set('sector')}
          disabled={disabled}
          aria-invalid={Boolean(errors.sector)}
          aria-describedby={describedBy('sector')}
        />,
      )}
      {field(
        'valuation',
        'Valuation (pre-money, €)',
        <Input
          id={`${id}-valuation`}
          type="number"
          inputMode="numeric"
          min={0}
          step={50_000}
          className={cn(inputClass, 'font-mono')}
          value={value.valuation}
          onChange={set('valuation')}
          disabled={disabled}
          aria-invalid={Boolean(errors.valuation)}
          aria-describedby={describedBy('valuation')}
        />,
        ValuationPreview.valuationHint(valuation),
      )}
      {field(
        'askAmount',
        'Ask amount (€)',
        <Input
          id={`${id}-askAmount`}
          type="number"
          inputMode="numeric"
          min={0}
          step={25_000}
          className={cn(inputClass, 'font-mono')}
          value={value.askAmount}
          onChange={set('askAmount')}
          disabled={disabled}
          aria-invalid={Boolean(errors.askAmount)}
          aria-describedby={describedBy('askAmount')}
        />,
        ValuationPreview.askHint(ask, valuation),
      )}
      {field(
        'description',
        'What does it do?',
        <Textarea
          id={`${id}-description`}
          rows={3}
          className="bg-card text-[15px]"
          value={value.description}
          onChange={set('description')}
          disabled={disabled}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={describedBy('description')}
        />,
      )}
    </div>
  );
}
