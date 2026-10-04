import type { GameStatus } from '@investor/shared';
import { cn } from '@/lib/utils';
import { StatusText, type StatusTone } from '@/lib/StatusText';

const TONES: Record<StatusTone, string> = {
  info: 'bg-info text-info-foreground',
  success: 'bg-accent text-accent-foreground',
  danger: 'bg-danger text-danger-foreground',
  neutral: 'bg-secondary text-secondary-foreground',
};

export function StatusPill({ status, className }: { status: GameStatus; className?: string }) {
  const pill = StatusText.pill(status);
  return (
    <span
      className={cn(
        'rounded-full px-3 py-1 text-[13px] font-semibold whitespace-nowrap',
        TONES[pill.tone],
        className,
      )}
    >
      {pill.label}
    </span>
  );
}
