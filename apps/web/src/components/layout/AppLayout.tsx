import { Link, Outlet } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { useTheme } from '@/hooks/useTheme';
import { StepIndicator } from './StepIndicator';
import { ThemeToggle } from './ThemeToggle';

/** Header (brand, steps, new game, theme) above every screen, plus the toast outlet. */
export function AppLayout() {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="bg-ink text-ink-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3.5 sm:px-6">
          <Link to="/" className="flex items-baseline gap-2.5 text-ink-foreground no-underline">
            <span className="font-heading text-[22px] font-bold tracking-tight">Investor</span>
            <span className="text-[13px] text-ink-muted">Negotiation game</span>
          </Link>
          <StepIndicator />
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex h-10 items-center rounded-lg border border-[#4A5160] px-3.5 text-[13px] text-ink-foreground no-underline hover:bg-ink-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              New game
            </Link>
            <ThemeToggle theme={theme} onToggle={toggle} />
          </div>
        </div>
      </header>
      <Outlet />
      <Toaster theme={theme} position="top-center" richColors closeButton />
    </div>
  );
}
