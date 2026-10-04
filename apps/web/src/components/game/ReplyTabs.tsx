import type { OfferInput, PlayerOption } from '@investor/shared';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CustomOfferForm } from './CustomOfferForm';
import { MessageComposer } from './MessageComposer';
import { PlayerOptions } from './PlayerOptions';

interface ReplyTabsProps {
  options: readonly PlayerOption[];
  offerInitial: OfferInput;
  /** Changes when a new player offer is stored, so the form restarts from it. */
  offerKey: string;
  startupName: string;
  askedValuation: number;
  draft: string;
  onDraftChange: (draft: string) => void;
  busy: boolean;
  onOption: (option: PlayerOption) => void;
  onOffer: (offer: OfferInput) => void;
  onMessage: (text: string) => void;
}

type Tab = 'options' | 'offer' | 'message';

// The app's --background is the page grey, so the selected tab gets the card colour and a shadow (as in the mock).
const TRIGGER =
  'min-h-10 px-3.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-input/60';

/** The player's three ways to reply. Every input is disabled while a turn is processing. */
export function ReplyTabs(props: ReplyTabsProps) {
  const [tab, setTab] = useState<Tab>('options');
  const { busy } = props;
  return (
    <section
      aria-label="Your move"
      className="rounded-2xl border bg-card px-[18px] py-4 text-card-foreground"
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-3.5">
        <TabsList aria-label="How to reply" className="h-auto! flex-wrap">
          <TabsTrigger value="options" className={TRIGGER}>
            Options
          </TabsTrigger>
          <TabsTrigger value="offer" className={TRIGGER}>
            Make an offer
          </TabsTrigger>
          <TabsTrigger value="message" className={TRIGGER}>
            Write a message
          </TabsTrigger>
        </TabsList>
        <TabsContent value="options">
          <PlayerOptions options={props.options} disabled={busy} onPick={props.onOption} />
        </TabsContent>
        <TabsContent value="offer">
          <CustomOfferForm
            key={props.offerKey}
            initial={props.offerInitial}
            startupName={props.startupName}
            askedValuation={props.askedValuation}
            disabled={busy}
            onSubmit={props.onOffer}
          />
        </TabsContent>
        <TabsContent value="message">
          <MessageComposer
            value={props.draft}
            onChange={props.onDraftChange}
            disabled={busy}
            onSend={props.onMessage}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
