import { Button } from '@/components/ui/button';

/** A failed load: what went wrong and a way to try again. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-5">
      <p className="m-0 text-sm">{message}</p>
      <Button type="button" variant="outline" className="h-10 px-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
