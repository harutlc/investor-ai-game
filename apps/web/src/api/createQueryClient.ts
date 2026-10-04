import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './ApiClientError';

/**
 * Queries retry once on network and server errors, never on a 4xx (a missing game stays missing).
 * Window-focus refetches are off: a background refetch must not race an in-flight turn.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) => !(error instanceof ApiClientError && error.isClientError) && failures < 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
