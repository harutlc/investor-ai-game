import { Check } from 'lucide-react';
import { useMatch } from 'react-router';
import { cn } from '@/lib/utils';

const STEPS = ['Setup', 'Negotiation', 'Debrief'] as const;

/** Setup → Negotiation → Debrief, with the current route's step highlighted and earlier ones done. */
export function StepIndicator() {
  const debrief = useMatch('/games/:id/debrief');
  const game = useMatch('/games/:id');
  const setup = useMatch('/');
  const current = debrief ? 2 : game ? 1 : setup ? 0 : -1;

  return (
    <nav aria-label="Game steps" className="flex grow flex-wrap gap-1.5">
      <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {STEPS.map((label, index) => {
          const state = index === current ? 'current' : index < current ? 'done' : 'todo';
          return (
            <li
              key={label}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium',
                state === 'current' && 'bg-white text-[#15181E]',
                state === 'done' && 'bg-ink-raised text-ink-muted',
                state === 'todo' && 'text-ink-muted',
              )}
            >
              <span className="font-mono text-xs">
                {state === 'done' ? <Check className="size-3.5" aria-hidden="true" /> : `0${index + 1}`}
              </span>
              {label}
              {state === 'done' && <span className="sr-only">(done)</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
