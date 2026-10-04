import { MoneyFormatter, ValuationCalculator, type GameSessionDto, type Offer } from '@investor/shared';
import { Link, Navigate, useParams } from 'react-router';
import { useGame } from '@/api/queries';
import { ErrorState } from '@/components/common/ErrorState';
import { MissingView } from '@/components/common/MissingView';
import { PersonaTile } from '@/components/common/PersonaTile';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErrorMessages } from '@/lib/ErrorMessages';
import { OfferFormatter } from '@/lib/OfferFormatter';
import { PersonaAppearance } from '@/lib/PersonaAppearance';
import { StatusText } from '@/lib/StatusText';

/** `/games/:id/debrief`: how a finished game ended. Only public data: no reveal of hidden numbers. */
export function DebriefPage() {
  const { id = '' } = useParams();
  const game = useGame(id);

  if (game.isPending) {
    return (
      <main
        aria-busy="true"
        aria-label="Loading the debrief"
        className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 sm:px-6"
      >
        <Skeleton className="h-44 rounded-[18px] bg-card" />
        <Skeleton className="h-56 rounded-2xl bg-card" />
      </main>
    );
  }
  if (game.isError) {
    return ErrorMessages.isMissingGame(game.error) ? (
      <MissingView title="Game not found" text="This game does not exist, or it belongs to another player." />
    ) : (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <ErrorState message={ErrorMessages.describe(game.error)} onRetry={() => void game.refetch()} />
      </main>
    );
  }
  if (game.data.status === 'negotiating') return <Navigate to={`/games/${id}`} replace />;
  return <Debrief session={game.data} />;
}

function Debrief({ session }: { session: GameSessionDto }) {
  const deal = session.status === 'deal' ? session.currentInvestorOffer : null;
  const firstName = PersonaAppearance.firstName(session.persona.name);
  const turnsUsed = `${session.turn} of ${session.maxTurns} turns used.`;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 pt-8 pb-16 sm:px-6">
      <section className="flex flex-col gap-2 rounded-[18px] bg-ink p-7 text-ink-foreground">
        <span
          className={cn(
            'text-[13px] font-semibold tracking-[0.06em] uppercase',
            deal ? 'text-[#8FD3B4]' : session.status === 'walked_away' ? 'text-[#F4A39A]' : 'text-ink-muted',
          )}
        >
          {StatusText.outcome(session.status)}
        </span>
        <h1 className="m-0 text-[clamp(32px,6vw,44px)] leading-[1.05] font-bold tracking-[-0.02em]">
          {deal ? OfferFormatter.short(deal) : StatusText.noDealHeadline(session.status, firstName)}
        </h1>
        <span className="text-[#C5CBD5]">
          {deal ? `${dealSummary(deal, session.pitch.valuation)} ${turnsUsed}` : turnsUsed}
        </span>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section
          aria-labelledby="terms-title"
          className="flex flex-col gap-2.5 rounded-2xl border bg-card p-5 text-card-foreground"
        >
          <h2 id="terms-title" className="m-0 text-xl font-bold">
            {deal ? 'Final terms' : 'Where it stopped'}
          </h2>
          <dl className="m-0 flex flex-col gap-2.5">
            {(deal ? dealTerms(deal) : noDealTerms(session)).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-secondary pb-2 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="m-0 text-right font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="flex items-center gap-3 rounded-2xl border bg-card p-5 text-card-foreground">
            <PersonaTile persona={session.persona} />
            <div className="flex flex-col">
              <span className="font-semibold">{session.persona.name}</span>
              <span className="text-[13px] text-muted-foreground">
                {session.pitch.name} · {session.pitch.sector}
              </span>
            </div>
          </section>
          <Link to={`/games/${session.id}`} className="text-sm text-primary underline underline-offset-4">
            Read the conversation again
          </Link>
          <Link
            to="/"
            className={buttonVariants({ className: 'h-12 rounded-xl px-5 text-base font-semibold' })}
          >
            Play again
          </Link>
        </aside>
      </div>
    </main>
  );
}

function dealSummary(deal: Offer, askedValuation: number): string {
  const pre = ValuationCalculator.impliedPreMoney(deal.investment, deal.equity);
  return `Post-money ${MoneyFormatter.compact(deal.impliedValuation)}, pre-money ${MoneyFormatter.compact(pre)} against your ask of ${MoneyFormatter.compact(askedValuation)}.`;
}

function dealTerms(deal: Offer): [string, string][] {
  return [
    ['Investment', MoneyFormatter.full(deal.investment)],
    ['Equity', `${deal.equity}%`],
    ['Post-money', MoneyFormatter.full(deal.impliedValuation)],
    ['Pre-money', MoneyFormatter.full(ValuationCalculator.impliedPreMoney(deal.investment, deal.equity))],
  ];
}

function noDealTerms(session: GameSessionDto): [string, string][] {
  return [
    [
      'Last investor offer',
      session.currentInvestorOffer ? OfferFormatter.short(session.currentInvestorOffer) : '—',
    ],
    ['Your last offer', session.lastPlayerOffer ? OfferFormatter.short(session.lastPlayerOffer) : '—'],
  ];
}
