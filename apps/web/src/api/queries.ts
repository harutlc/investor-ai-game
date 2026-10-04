import type { CreateGameRequest, PlayTurnRequest } from '@investor/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './apiContext';
import { queryKeys } from './queryKeys';

/** The investor personas. They are fixed while the API runs, so they are fetched once per page load. */
export function usePersonas() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.personas, queryFn: () => api.listPersonas(), staleTime: Infinity });
}

/** The player's games, newest first. */
export function useGames() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.games, queryFn: () => api.listGames() });
}

export function useGame(id: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.game(id), queryFn: () => api.getGame(id) });
}

/** The decision log of a game (the brain-insights sheet and its summary). */
export function useInsights(id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.insights(id), queryFn: () => api.getInsights(id), enabled });
}

/** Starts a game and seeds its view, so the negotiation screen opens without another request. */
export function useStartGame() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateGameRequest) => api.startGame(request),
    onSuccess: async (game) => {
      queryClient.setQueryData(queryKeys.game(game.id), game);
      await queryClient.invalidateQueries({ queryKey: queryKeys.games });
    },
  });
}

/**
 * Plays one turn. On success the returned session replaces the cached view; the list and the insights
 * become stale. Nothing is written optimistically, so a failed turn leaves the cache as it was.
 */
export function usePlayTurn(id: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: PlayTurnRequest) => api.playTurn(id, request),
    onSuccess: async (result) => {
      queryClient.setQueryData(queryKeys.game(id), result.session);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games }),
        queryClient.invalidateQueries({ queryKey: queryKeys.insights(id) }),
      ]);
    },
  });
}
