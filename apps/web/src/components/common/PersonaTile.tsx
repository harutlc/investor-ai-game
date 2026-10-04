import type { InvestorPersonaDto } from '@investor/shared';
import { cn } from '@/lib/utils';
import { PersonaAppearance } from '@/lib/PersonaAppearance';

const SIZES = {
  sm: 'size-8 rounded-[9px] text-xs',
  md: 'size-10 rounded-[11px] text-sm',
  lg: 'size-11 rounded-xl text-[15px]',
} as const;

/** The persona's initials on its colour. Decorative: the name is always shown next to it. */
export function PersonaTile({
  persona,
  size = 'md',
  className,
}: {
  persona: Pick<InvestorPersonaDto, 'id' | 'name'>;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const look = PersonaAppearance.of(persona);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-mono text-white',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: look.color }}
    >
      {look.initials}
    </span>
  );
}
