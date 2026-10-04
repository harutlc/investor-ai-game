import { vi, type Mock } from 'vitest';
import type { GameApi } from '@/api/GameApi';

export type StubApi = { [K in keyof GameApi]: Mock<GameApi[K]> };

/** A GameApi whose every method is a vi.fn that fails until a test scripts it. */
export function stubApi(): StubApi {
  const unscripted = (name: string) => () => Promise.reject(new Error(`${name} was not scripted`));
  return {
    listPersonas: vi.fn<GameApi['listPersonas']>(unscripted('listPersonas')),
    listGames: vi.fn<GameApi['listGames']>(unscripted('listGames')),
    getGame: vi.fn<GameApi['getGame']>(unscripted('getGame')),
    startGame: vi.fn<GameApi['startGame']>(unscripted('startGame')),
    playTurn: vi.fn<GameApi['playTurn']>(unscripted('playTurn')),
    getInsights: vi.fn<GameApi['getInsights']>(unscripted('getInsights')),
  };
}
