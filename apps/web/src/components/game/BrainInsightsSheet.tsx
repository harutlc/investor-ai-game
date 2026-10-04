import type { DecisionInsightsDto, DecisionLogEntryDto } from '@investor/shared';
import { ChevronRight, Cpu } from 'lucide-react';
import { ErrorState } from '@/components/common/ErrorState';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { DecisionAnswerFormatter } from '@/lib/DecisionAnswerFormatter';

interface BrainInsightsSheetProps {
  insights: DecisionInsightsDto | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** The decision model's answers per turn, behind a summary button. Makes "brain vs voice" visible. */
export function BrainInsightsSheet({ insights, loading, error, onRetry }: BrainInsightsSheetProps) {
  const entries = insights ? [...insights.entries].reverse() : [];
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 items-center gap-3 rounded-2xl border bg-card px-[18px] py-4 text-left text-card-foreground hover:border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-ink text-ink-foreground">
            <Cpu className="size-5" aria-hidden="true" />
          </span>
          <span className="flex grow flex-col">
            <span className="font-semibold">Brain insights</span>
            <span className="text-[13px] text-muted-foreground">{summary(insights, loading)}</span>
          </span>
          <ChevronRight className="size-[18px] text-muted-foreground" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-[460px]">
        <SheetHeader className="pr-12">
          <SheetTitle className="font-heading text-[22px] font-bold">Brain insights</SheetTitle>
          <SheetDescription>
            What the decision model answered, per turn. The LLM only phrases what code decided.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3.5 px-4 pb-6">
          {error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : loading && !insights ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : entries.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">
              No decision calls yet. The opening offer is computed by code from the persona's hidden numbers.
            </p>
          ) : (
            entries.map((entry, index) => (
              <Entry key={`${entry.turn}-${entry.stage}-${index}`} entry={entry} />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function summary(insights: DecisionInsightsDto | undefined, loading: boolean): string {
  if (!insights) return loading ? 'Loading…' : 'Decision log';
  const count = insights.entries.length;
  if (count === 0) return 'No decision calls yet';
  const latest = Math.max(...insights.entries.map((entry) => entry.turn));
  return `${count} decision call${count === 1 ? '' : 's'} · latest turn ${latest}`;
}

function Entry({ entry }: { entry: DecisionLogEntryDto }) {
  const rows = DecisionAnswerFormatter.rows(entry);
  return (
    <article className="overflow-hidden rounded-xl border">
      <header className="flex flex-wrap items-center justify-between gap-2 bg-secondary px-3 py-2.5">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-md px-2 py-0.5 font-mono text-xs text-white',
              entry.stage === 'A' ? 'bg-stage-a' : 'bg-[#15181E] dark:bg-[#3A404C]',
            )}
          >
            {DecisionAnswerFormatter.stageLabel(entry.stage)}
          </span>
          <span className="text-sm font-semibold">Turn {entry.turn}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground">{DecisionAnswerFormatter.meta(entry)}</span>
      </header>
      <div className="flex flex-col gap-2 px-3 pt-2 pb-3">
        {entry.errorCode ? (
          <p className="m-0 text-[13px] text-destructive">
            Failed: <span className="font-mono">{entry.errorCode}</span>
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.name}
              data-testid="answer-row"
              className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-x-2.5 gap-y-1 text-[13px]"
            >
              <span className="flex flex-wrap items-baseline gap-1.5">
                <span className="font-mono text-foreground">{row.name}</span>
                <span className="text-[11px] text-muted-foreground">{row.type}</span>
                {row.uncertain && (
                  <span className="rounded-full bg-warn px-1.5 text-[11px] font-semibold text-warn-foreground">
                    uncertain
                  </span>
                )}
              </span>
              <span className="text-right font-mono text-xs text-muted-foreground">
                {Math.round(row.confidence * 100)}%
              </span>
              <span className="font-semibold">{row.display}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                <div
                  className={cn('h-full', row.uncertain ? 'bg-[#C2580A]' : 'bg-muted-foreground')}
                  style={{ width: `${Math.round(row.confidence * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
