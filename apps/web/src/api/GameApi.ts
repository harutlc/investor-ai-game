import type { GameApiClient } from './GameApiClient';

/** What screens and hooks need from the API client; tests provide a stub of this shape. */
export type GameApi = Pick<
  GameApiClient,
  'listPersonas' | 'listGames' | 'getGame' | 'startGame' | 'playTurn' | 'getInsights'
>;
