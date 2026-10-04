import type { InvestorMeters as Meters } from '@investor/shared';
import { Clock, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const LEVELS: Record<Meters['interestLevel'], { label: string; filled: number }> = {
  low: { label: 'Low', filled: 1 },
  medium: { label: 'Medium', filled: 2 },
  high: { label: 'High', filled: 3 },
};

/** What the player may see of the investor's mood: words and a 3-step bar, never numbers. */
export function InvestorMeters({ meters, firstName }: { meters: Meters; firstName: string }) {
  const interest = LEVELS[meters.interestLevel];
  return (
    <section
      aria-labelledby="mood-title"
      className="flex flex-col gap-3.5 rounded-2xl border bg-card p-[18px] text-card-foreground"
    >
      <h2 id="mood-title" className="m-0 text-lg font-bold">
        How {firstName} seems
      </h2>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[13px]">
          <span className="font-semibold">Interest</span>
          <span>{interest.label}</span>
        </div>
        <div className="grid grid-cols-3 gap-1" aria-hidden="true">
          {[1, 2, 3].map((segment) => (
            <div
              key={segment}
              data-testid="interest-segment"
              data-filled={segment <= interest.filled}
              className={cn('h-2 rounded', segment <= interest.filled ? 'bg-primary' : 'bg-border')}
            />
          ))}
        </div>
      </div>
      <Hint
        icon={<Clock className="size-[18px]" aria-hidden="true" />}
        title="Patience"
        text={meters.patienceHint}
      />
      {meters.trustHint && (
        <Hint
          icon={<Shield className="size-[18px]" aria-hidden="true" />}
          title="Trust"
          text={meters.trustHint}
        />
      )}
      <span className="text-xs text-muted-foreground">Hints only. The real numbers stay hidden.</span>
    </section>
  );
}

function Hint({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="flex flex-col">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{text}</span>
      </div>
    </div>
  );
}
