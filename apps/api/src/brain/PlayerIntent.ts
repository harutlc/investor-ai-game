/** What a free-text player move is trying to do; Stage A's `intent` question chooses one. */
export const PLAYER_INTENTS = [
  'counter_offer',
  'accept',
  'decline',
  'ask_question',
  'answer_question',
  'leverage_claim',
  'small_talk',
  'other',
] as const;

export type PlayerIntent = (typeof PLAYER_INTENTS)[number];
