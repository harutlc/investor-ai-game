import { MoneyFormatter, type GameSessionDto, type Offer } from '@investor/shared';
import { OfferFormatter } from '@/lib/OfferFormatter';

type DealPanelProps = Pick<
  GameSessionDto,
  'turn' | 'maxTurns' | 'currentInvestorOffer' | 'lastPlayerOffer' | 'pitch'
>;

/** Both sides' current offers, the gap between them, and the turn counter. */
export function DealPanel({ turn, maxTurns, currentInvestorOffer, lastPlayerOffer, pitch }: DealPanelProps) {
  const used = Math.min(turn, maxTurns);
  return (
    <section
      aria-labelledby="deal-title"
      className="flex flex-col gap-3.5 rounded-2xl border bg-card p-[18px] text-card-foreground"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="deal-title" className="m-0 text-lg font-bold">
          The deal
        </h2>
        <span className="font-mono text-[13px] text-muted-foreground">
          Turn {used} / {maxTurns}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Turns used"
        aria-valuemin={0}
        aria-valuemax={maxTurns}
        aria-valuenow={used}
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full bg-foreground" style={{ width: `${Math.round((used / maxTurns) * 100)}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <OfferBox title="Investor offers" offer={currentInvestorOffer} tone="investor" />
        <OfferBox title="Your last offer" offer={lastPlayerOffer} tone="player" />
      </div>
      <span className="text-[13px]">
        {currentInvestorOffer && lastPlayerOffer
          ? OfferFormatter.gap(currentInvestorOffer, lastPlayerOffer)
          : 'Make an offer to see the gap.'}
      </span>
      <span className="text-xs text-muted-foreground">
        You asked {MoneyFormatter.compact(pitch.askAmount)} at {MoneyFormatter.compact(pitch.valuation)}{' '}
        pre-money.
      </span>
    </section>
  );
}

function OfferBox({
  title,
  offer,
  tone,
}: {
  title: string;
  offer: Offer | null;
  tone: 'investor' | 'player';
}) {
  const investor = tone === 'investor';
  return (
    <div
      className={`flex min-w-0 flex-col gap-0.5 rounded-xl p-3 ${investor ? 'bg-accent text-accent-foreground' : 'bg-secondary text-secondary-foreground'}`}
    >
      <span className="text-xs font-semibold">{title}</span>
      <span className="font-mono text-base">{offer ? OfferFormatter.short(offer) : '—'}</span>
      <span className={`text-xs ${investor ? '' : 'text-muted-foreground'}`}>
        {offer ? OfferFormatter.valuation(offer) : 'No offer yet'}
      </span>
    </div>
  );
}
