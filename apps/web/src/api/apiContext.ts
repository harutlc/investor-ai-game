import { createContext, use } from 'react';
import type { GameApi } from './GameApi';

export const ApiContext = createContext<GameApi | null>(null);

/** The API client of the nearest ApiProvider. */
export function useApi(): GameApi {
  const api = use(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
