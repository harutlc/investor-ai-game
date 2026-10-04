import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiProvider } from '@/api/ApiProvider';
import { createQueryClient } from '@/api/createQueryClient';
import { GameApiClient } from '@/api/GameApiClient';
import { routes } from './routes';

export function App() {
  const [api] = useState(() => GameApiClient.fromEnv());
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <ApiProvider api={api} queryClient={queryClient}>
      <RouterProvider router={router} />
    </ApiProvider>
  );
}
