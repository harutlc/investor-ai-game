import type { PlayerOption, PlayerOptionKind } from '@investor/shared';
import { cn } from '@/lib/utils';

const KIND_LABELS: Record<PlayerOptionKind, string> = {
  counter: 'Counter',
  accept: 'Accept',
  decline: 'Decline',
  message: 'Ask',
  answer: 'Answer',
  leverage: 'Leverage',
};

const KIND_STYLES: Partial<Record<PlayerOptionKind, string>> = {
  accept: 'border-[#A9D1BE] bg-accent text-accent-foreground dark:border-accent-foreground/40',
  decline: 'border-[#E8B4AE] bg-card text-destructive dark:border-destructive/50',
};

interface PlayerOptionsProps {
  options: readonly PlayerOption[];
  disabled: boolean;
  onPick: (option: PlayerOption) => void;
}

/** The generated reply options. Accept is styled positive, Decline destructive. */
export function PlayerOptions({ options, disabled, onPick }: PlayerOptionsProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        Suggested replies, generated each turn by the LLM; numbers are checked by code.
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(option)}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-input bg-card px-3.5 py-2 text-left text-sm text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55',
              KIND_STYLES[option.kind],
            )}
          >
            <span className="text-[11px] font-semibold tracking-[0.04em] uppercase opacity-80">
              {KIND_LABELS[option.kind]}
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
