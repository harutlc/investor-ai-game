import { QueryClient } from '@tanstack/react-query';
import { render, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ApiProvider } from '@/api/ApiProvider';
import { routes } from '@/routes';
import { stubApi, type StubApi } from './stubApi';

export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapper(api: StubApi, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ApiProvider api={api} queryClient={queryClient}>
        {children}
      </ApiProvider>
    );
  };
}

/** Renders `ui` under an ApiProvider with a stub API and a fresh, non-retrying query cache. */
export function renderWithApi(ui: ReactElement, api: StubApi = stubApi(), queryClient = testQueryClient()) {
  return { api, queryClient, ...render(ui, { wrapper: wrapper(api, queryClient) }) };
}

export function renderHookWithApi<T>(
  hook: () => T,
  api: StubApi = stubApi(),
  queryClient = testQueryClient(),
) {
  return { api, queryClient, ...renderHook(hook, { wrapper: wrapper(api, queryClient) }) };
}

/** Renders the whole app's routes at `path` (memory router) with a stub API. */
export function renderRoute(path: string, api: StubApi = stubApi(), queryClient = testQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ApiProvider api={api} queryClient={queryClient}>
      <RouterProvider router={router} />
    </ApiProvider>,
  );
  return { api, queryClient, router, ...view };
}
