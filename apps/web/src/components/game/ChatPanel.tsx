import type { ChatMessage, GameStatus, InvestorPersonaDto } from '@investor/shared';
import { useEffect, useRef } from 'react';
import { PersonaTile } from '@/components/common/PersonaTile';
import { StatusPill } from '@/components/common/StatusPill';
import { PersonaAppearance } from '@/lib/PersonaAppearance';

interface ChatPanelProps {
  persona: InvestorPersonaDto;
  status: GameStatus;
  messages: readonly ChatMessage[];
  /** The player's move while its turn is processing; shown with a typing indicator. */
  pendingText: string | null;
}

/** The transcript: investor left, player right, system lines centred; scrolls to the newest message. */
export function ChatPanel({ persona, status, messages, pendingText }: ChatPanelProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const firstName = PersonaAppearance.firstName(persona.name);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length, pendingText]);

  return (
    <section
      aria-label="Conversation"
      className="overflow-hidden rounded-2xl border bg-card text-card-foreground"
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-[18px] py-3.5">
        <PersonaTile persona={persona} />
        <div className="flex min-w-0 grow flex-col">
          <span className="font-semibold">{persona.name}</span>
          <span className="text-[13px] text-muted-foreground">{persona.tagline}</span>
        </div>
        <StatusPill status={status} />
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Messages"
        className="flex h-[min(500px,60dvh)] flex-col gap-3.5 overflow-y-auto bg-chat px-[18px] py-5"
      >
        {messages.map((message) => (
          <Message key={message.id} message={message} persona={persona} />
        ))}
        {pendingText !== null && (
          <>
            <PlayerBubble text={pendingText} pending />
            <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
              <PersonaTile persona={persona} size="sm" />
              <span aria-hidden="true" className="inline-flex gap-1 rounded-xl border bg-card px-3 py-2.5">
                {[0, 0.2, 0.4].map((delay) => (
                  <span
                    key={delay}
                    className="size-1.5 rounded-full bg-muted-foreground"
                    style={{ animation: `typing-dot 1.2s infinite ${delay}s` }}
                  />
                ))}
              </span>
              <span>{firstName} is typing…</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Message({ message, persona }: { message: ChatMessage; persona: InvestorPersonaDto }) {
  switch (message.role) {
    case 'system':
      return (
        <p className="mx-auto my-0 max-w-[560px] text-center text-[13px] text-muted-foreground">
          {message.text}
        </p>
      );
    case 'event':
      return (
        <p className="mx-auto my-0 max-w-[560px] rounded-xl border bg-warn px-3.5 py-2.5 text-sm text-warn-foreground">
          <strong>Market event</strong> · {message.text}
        </p>
      );
    case 'investor':
      return (
        <div className="flex max-w-[85%] items-end gap-2.5 sm:max-w-[78%]">
          <PersonaTile persona={persona} size="sm" />
          <div className="rounded-[14px_14px_14px_4px] border bg-card px-3.5 py-2.5">
            <span className="sr-only">{persona.name}: </span>
            {message.text}
          </div>
        </div>
      );
    case 'player':
      return <PlayerBubble text={message.text} />;
  }
}

function PlayerBubble({ text, pending = false }: { text: string; pending?: boolean }) {
  return (
    <div className="flex justify-end" data-pending={pending || undefined}>
      <div
        className={`max-w-[85%] rounded-[14px_14px_4px_14px] bg-bubble px-3.5 py-2.5 text-bubble-foreground sm:max-w-[78%] ${pending ? 'opacity-70' : ''}`}
      >
        <span className="sr-only">You{pending ? ' (sending)' : ''}: </span>
        {text}
      </div>
    </div>
  );
}
