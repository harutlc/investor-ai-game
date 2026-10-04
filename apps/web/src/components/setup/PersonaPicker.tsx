import type { InvestorPersonaDto } from '@investor/shared';
import { ErrorState } from '@/components/common/ErrorState';
import { PersonaTile } from '@/components/common/PersonaTile';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface PersonaPickerProps {
  personas: readonly InvestorPersonaDto[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** Investor cards; exactly one is selected (`aria-pressed`). */
export function PersonaPicker({
  personas,
  selectedId,
  onSelect,
  loading,
  error,
  onRetry,
}: PersonaPickerProps) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3.5">
      {loading || !personas
        ? Array.from({ length: 6 }, (_, index) => (
            <Skeleton
              key={index}
              data-testid="persona-skeleton"
              className="h-[150px] rounded-[14px] bg-card"
            />
          ))
        : personas.map((persona) => {
            const selected = persona.id === selectedId;
            return (
              <button
                key={persona.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(persona.id)}
                className={cn(
                  'flex flex-col gap-3 rounded-[14px] border-2 bg-card p-[18px] text-left text-card-foreground transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  selected
                    ? 'border-primary shadow-[0_6px_20px_rgba(21,24,30,0.10)]'
                    : 'border-border hover:border-input',
                )}
              >
                <span className="flex items-center gap-3">
                  <PersonaTile persona={persona} size="lg" />
                  <span className="flex flex-col">
                    <span className="text-base font-semibold">{persona.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{persona.id}</span>
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">{persona.tagline}</span>
                <span className="flex flex-wrap gap-1.5">
                  {persona.traits.map((trait) => (
                    <span
                      key={trait}
                      className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
                    >
                      {trait}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
    </div>
  );
}
