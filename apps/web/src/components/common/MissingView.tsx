import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';

/** "Page not found" / "Game not found": a heading, a line and the way back to setup. */
export function MissingView({ title, text }: { title: string; text: string }) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="m-0 text-3xl font-bold tracking-tight">{title}</h1>
      <p className="m-0 text-muted-foreground">{text}</p>
      <Link to="/" className={buttonVariants({ className: 'h-11 px-5 text-[15px]' })}>
        Start a new game
      </Link>
    </section>
  );
}
