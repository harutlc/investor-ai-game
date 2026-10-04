import type { GameSummaryDto } from '@investor/shared';
import { Link } from 'react-router';
import { PersonaTile } from '@/components/common/PersonaTile';
import { StatusPill } from '@/components/common/StatusPill';
import { OfferFormatter } from '@/lib/OfferFormatter';

/** The player's earlier games; each opens its negotiation screen. */
export function GameList({ games }: { games: readonly GameSummaryDto[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3 p-0">
      {games.map((game) => (
        <li key={game.id}>
          <Link
            to={`/games/${game.id}`}
            className="flex h-full flex-col gap-2.5 rounded-[14px] border bg-card p-4 text-card-foreground no-underline hover:border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="flex items-center gap-3">
              <PersonaTile persona={game.persona} />
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate font-semibold">{game.startupName}</span>
                <span className="truncate text-[13px] text-muted-foreground">with {game.persona.name}</span>
              </span>
              <StatusPill status={game.status} />
            </span>
            <span className="flex flex-wrap justify-between gap-2 text-[13px] text-muted-foreground">
              <span className="font-mono">
                turn {game.turn} / {game.maxTurns}
              </span>
              {game.currentInvestorOffer && (
                <span>
                  Investor:{' '}
                  <span className="font-mono text-foreground">
                    {OfferFormatter.short(game.currentInvestorOffer)}
                  </span>
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
