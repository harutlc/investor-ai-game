import { SendHorizontal } from 'lucide-react';
import { useId, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export const MAX_MESSAGE_LENGTH = 1000;

interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onSend: (text: string) => void;
}

/** Free text: bluff, flatter, argue. Enter sends, Shift+Enter adds a line. */
export function MessageComposer({ value, onChange, disabled, onSend }: MessageComposerProps) {
  const id = useId();
  const text = value.trim();
  const canSend = !disabled && text.length > 0 && text.length <= MAX_MESSAGE_LENGTH;

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSend(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form noValidate onSubmit={send} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Write anything: bluff, flatter, argue. The investor's brain works out what you meant and which numbers
        you proposed.
      </label>
      <div className="flex items-end gap-2.5">
        <Textarea
          id={id}
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder="€500k for 20%, and we already have interest from another fund."
          className="min-h-12 grow resize-y bg-card text-[15px]"
        />
        <Button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className="size-12 shrink-0 rounded-[10px]"
        >
          <SendHorizontal className="size-5" aria-hidden="true" />
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">Enter sends · Shift+Enter for a new line</span>
    </form>
  );
}
