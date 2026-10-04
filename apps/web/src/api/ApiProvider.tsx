import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiContext } from './apiContext';
import type { GameApi } from './GameApi';

interface ApiProviderProps {
  api: GameApi;
  queryClient: QueryClient;
  children: ReactNode;
}

/** Makes the API client and the query cache available to every hook below it. */
export function ApiProvider({ api, queryClient, children }: ApiProviderProps) {
  return (
    <ApiContext value={api}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext>
  );
}
