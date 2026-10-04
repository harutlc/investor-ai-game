/** TanStack Query keys, in one place so mutations invalidate exactly what the queries cache. */
export const queryKeys = {
  personas: ['personas'] as const,
  games: ['games'] as const,
  game: (id: string) => ['game', id] as const,
  insights: (id: string) => ['insights', id] as const,
};
