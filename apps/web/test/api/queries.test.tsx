import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/api/ApiClientError';
import { usePlayTurn, useStartGame } from '@/api/queries';
import { queryKeys } from '@/api/queryKeys';
import { renderHookWithApi } from '../support/render';
import { GAME_ID, PITCH, session, turnResult } from '../support/fixtures';

describe('useStartGame', () => {
  it('seeds the new game and marks the list stale', async () => {
    const { result, api, queryClient } = renderHookWithApi(() => useStartGame());
    const game = session();
    api.startGame.mockResolvedValue(game);
    queryClient.setQueryData(queryKeys.games, { games: [] });

    await act(() => result.current.mutateAsync({ personaId: 'greedy-shark', pitch: PITCH }));

    expect(api.startGame).toHaveBeenCalledWith({ personaId: 'greedy-shark', pitch: PITCH });
    expect(queryClient.getQueryData(queryKeys.game(GAME_ID))).toBe(game);
    expect(queryClient.getQueryState(queryKeys.games)?.isInvalidated).toBe(true);
  });
});

describe('usePlayTurn', () => {
  it('replaces the cached session and invalidates the list and the insights', async () => {
    const { result, api, queryClient } = renderHookWithApi(() => usePlayTurn(GAME_ID));
    const played = turnResult();
    api.playTurn.mockResolvedValue(played);
    queryClient.setQueryData(queryKeys.game(GAME_ID), session());
    queryClient.setQueryData(queryKeys.games, { games: [] });
    queryClient.setQueryData(queryKeys.insights(GAME_ID), { entries: [] });

    await act(() => result.current.mutateAsync({ offer: { investment: 500_000, equity: 20 } }));

    expect(api.playTurn).toHaveBeenCalledWith(GAME_ID, { offer: { investment: 500_000, equity: 20 } });
    expect(queryClient.getQueryData(queryKeys.game(GAME_ID))).toEqual(played.session);
    expect(queryClient.getQueryState(queryKeys.games)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.insights(GAME_ID))?.isInvalidated).toBe(true);
  });

  it('leaves the cache untouched when the turn fails', async () => {
    const { result, api, queryClient } = renderHookWithApi(() => usePlayTurn(GAME_ID));
    api.playTurn.mockRejectedValue(
      new ApiClientError({ code: 'TURN_IN_PROGRESS', message: 'busy', status: 409 }),
    );
    const before = session();
    queryClient.setQueryData(queryKeys.game(GAME_ID), before);
    queryClient.setQueryData(queryKeys.insights(GAME_ID), { entries: [] });

    act(() => result.current.mutate({ optionId: 'opt-1-1' }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(queryKeys.game(GAME_ID))).toBe(before);
    expect(queryClient.getQueryState(queryKeys.insights(GAME_ID))?.isInvalidated).toBe(false);
  });
});
