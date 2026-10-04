import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ApiClientError } from '@/api/ApiClientError';
import { useGames, usePersonas, useStartGame } from '@/api/queries';
import { GameList } from '@/components/setup/GameList';
import { PersonaPicker } from '@/components/setup/PersonaPicker';
import { PitchForm } from '@/components/setup/PitchForm';
import { Button } from '@/components/ui/button';
import { ErrorMessages } from '@/lib/ErrorMessages';
import { PitchValidator, type PitchDraft, type PitchErrors } from '@/lib/PitchValidator';

/** `/`: choose an investor, describe the startup, start; or resume an earlier game. */
export function SetupPage() {
  const navigate = useNavigate();
  const personas = usePersonas();
  const games = useGames();
  const startGame = useStartGame();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PitchDraft>(PitchValidator.DEFAULT_DRAFT);
  const [serverErrors, setServerErrors] = useState<PitchErrors>({});

  const selected =
    personas.data?.personas.find((p) => p.id === chosenId) ?? personas.data?.personas[0] ?? null;
  const { pitch, errors } = PitchValidator.validate(draft);
  const shownErrors = { ...serverErrors, ...errors };

  const start = () => {
    if (!selected || !pitch) return;
    startGame.mutate(
      { personaId: selected.id, pitch },
      {
        onSuccess: (game) => void navigate(`/games/${game.id}`),
        onError: (error) => {
          if (error instanceof ApiClientError && error.code === 'VALIDATION_ERROR') {
            setServerErrors(PitchValidator.fromServerDetails(error.details));
          }
          toast.error(ErrorMessages.describe(error));
        },
      },
    );
  };

  const onDraftChange = (next: PitchDraft) => {
    setDraft(next);
    setServerErrors({});
  };

  const myGames = games.data?.games ?? [];

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pt-8 pb-16 sm:px-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[clamp(30px,5vw,40px)] leading-[1.1] font-bold tracking-[-0.02em]">
          Pitch your startup. Close the deal.
        </h1>
        <p className="m-0 max-w-[640px] text-muted-foreground">
          Pick the investor you want to face, describe your company, and negotiate the investment and equity.
          The investor decides with a decision model and speaks with an LLM.
        </p>
      </div>

      <section aria-labelledby="pick-title" className="flex flex-col gap-3.5">
        <h2 id="pick-title" className="m-0 text-[22px] font-bold">
          1. Choose your investor
        </h2>
        <PersonaPicker
          personas={personas.data?.personas}
          selectedId={selected?.id ?? null}
          onSelect={setChosenId}
          loading={personas.isPending}
          error={personas.isError ? ErrorMessages.describe(personas.error) : null}
          onRetry={() => void personas.refetch()}
        />
      </section>

      <section aria-labelledby="pitch-title" className="flex flex-col gap-3.5">
        <h2 id="pitch-title" className="m-0 text-[22px] font-bold">
          2. Your pitch
        </h2>
        <PitchForm
          value={draft}
          errors={shownErrors}
          onChange={onDraftChange}
          disabled={startGame.isPending}
        />
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="button"
          onClick={start}
          disabled={!selected || !pitch || startGame.isPending}
          aria-busy={startGame.isPending}
          className="h-12 rounded-[10px] px-6 text-base font-semibold"
        >
          {startGame.isPending
            ? 'Starting…'
            : selected
              ? `Start negotiation with ${selected.name}`
              : 'Start negotiation'}
        </Button>
        <span className="text-sm text-muted-foreground">
          Up to 15 turns. The investor's real limits stay hidden.
        </span>
      </div>

      {myGames.length > 0 && (
        <section aria-labelledby="games-title" className="flex flex-col gap-3.5">
          <h2 id="games-title" className="m-0 text-[22px] font-bold">
            Your games
          </h2>
          <GameList games={myGames} />
        </section>
      )}
    </main>
  );
}
