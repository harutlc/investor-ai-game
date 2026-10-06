import { wrapCreateBrowserRouterV7 } from '@sentry/react';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiProvider } from '@/api/ApiProvider';
import { createQueryClient } from '@/api/createQueryClient';
import { GameApiClient } from '@/api/GameApiClient';
import { routes } from './routes';

const sentryCreateBrowserRouter = wrapCreateBrowserRouterV7(createBrowserRouter);

export function App() {
  const [api] = useState(() => GameApiClient.fromEnv());
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => sentryCreateBrowserRouter(routes));
  return (
    <ApiProvider api={api} queryClient={queryClient}>
      <RouterProvider router={router} />
    </ApiProvider>
  );
}
