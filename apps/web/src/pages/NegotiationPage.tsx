import type { GameSessionDto, PlayTurnRequest } from '@investor/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useGame, useInsights, usePlayTurn } from '@/api/queries';
import { ErrorState } from '@/components/common/ErrorState';
import { MissingView } from '@/components/common/MissingView';
import { BrainInsightsSheet } from '@/components/game/BrainInsightsSheet';
import { ChatPanel } from '@/components/game/ChatPanel';
import { DealPanel } from '@/components/game/DealPanel';
import { InvestorMeters } from '@/components/game/InvestorMeters';
import { ReplyTabs } from '@/components/game/ReplyTabs';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorMessages } from '@/lib/ErrorMessages';
import { PendingMove } from '@/lib/PendingMove';
import { PersonaAppearance } from '@/lib/PersonaAppearance';
import { StatusText } from '@/lib/StatusText';
import { ValuationPreview } from '@/lib/ValuationPreview';

/** `/games/:id`: the conversation, the player's move, and the deal and mood panels. */
export function NegotiationPage() {
  const { id = '' } = useParams();
  const game = useGame(id);

  if (game.isPending) return <NegotiationSkeleton />;
  if (game.isError) {
    return ErrorMessages.isMissingGame(game.error) ? (
      <MissingView title="Game not found" text="This game does not exist, or it belongs to another player." />
    ) : (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <ErrorState message={ErrorMessages.describe(game.error)} onRetry={() => void game.refetch()} />
      </main>
    );
  }
  return <Negotiation session={game.data} />;
}

function Negotiation({ session }: { session: GameSessionDto }) {
  const playTurn = usePlayTurn(session.id);
  const insights = useInsights(session.id, true);
  const [draft, setDraft] = useState('');

  const busy = playTurn.isPending;
  const negotiating = session.status === 'negotiating';
  const firstName = PersonaAppearance.firstName(session.persona.name);
  const pendingText =
    busy && playTurn.variables ? PendingMove.text(playTurn.variables, session.options) : null;

  const play = (request: PlayTurnRequest) => {
    if (busy) return;
    playTurn.mutate(request, {
      onSuccess: () => {
        if (request.message !== undefined) setDraft('');
      },
      onError: (error) => toast.error(ErrorMessages.describe(error)),
    });
  };

  const lastOffer = session.lastPlayerOffer;
  const offerInitial = lastOffer
    ? { investment: lastOffer.investment, equity: lastOffer.equity }
    : {
        investment: session.pitch.askAmount,
        equity: ValuationPreview.defaultEquity(session.pitch.askAmount, session.pitch.valuation),
      };

  return (
    <main className="mx-auto grid max-w-7xl items-start gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <ChatPanel
          persona={session.persona}
          status={session.status}
          messages={session.messages}
          pendingText={pendingText}
        />
        {negotiating ? (
          <ReplyTabs
            options={session.options}
            offerInitial={offerInitial}
            offerKey={lastOffer ? `${lastOffer.turn}` : 'ask'}
            startupName={session.pitch.name}
            askedValuation={session.pitch.valuation}
            draft={draft}
            onDraftChange={setDraft}
            busy={busy}
            onOption={(option) => play({ optionId: option.id })}
            onOffer={(offer) => play({ offer })}
            onMessage={(message) => play({ message })}
          />
        ) : (
          <section
            aria-label="Game over"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-[18px] py-4"
          >
            <span className="font-semibold">{StatusText.endBanner(session.status)}</span>
            <Link
              to={`/games/${session.id}/debrief`}
              className={buttonVariants({
                className: 'h-[46px] rounded-[10px] px-5 text-[15px] font-semibold',
              })}
            >
              See the debrief
            </Link>
          </section>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <DealPanel
          turn={session.turn}
          maxTurns={session.maxTurns}
          currentInvestorOffer={session.currentInvestorOffer}
          lastPlayerOffer={session.lastPlayerOffer}
          pitch={session.pitch}
        />
        <InvestorMeters meters={session.meters} firstName={firstName} />
        <BrainInsightsSheet
          insights={insights.data}
          loading={insights.isPending}
          error={insights.isError ? ErrorMessages.describe(insights.error) : null}
          onRetry={() => void insights.refetch()}
        />
      </aside>
    </main>
  );
}

function NegotiationSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading the game"
      className="mx-auto grid max-w-7xl items-start gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      <div className="flex flex-col gap-4">
        <Skeleton className="h-[min(570px,70dvh)] rounded-2xl bg-card" />
        <Skeleton className="h-36 rounded-2xl bg-card" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-56 rounded-2xl bg-card" />
        <Skeleton className="h-44 rounded-2xl bg-card" />
      </div>
    </main>
  );
}
