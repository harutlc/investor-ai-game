import type { RouteObject } from 'react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DebriefPage } from '@/pages/DebriefPage';
import { NegotiationPage } from '@/pages/NegotiationPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { SetupPage } from '@/pages/SetupPage';

export const routes: RouteObject[] = [
  {
    Component: AppLayout,
    children: [
      { index: true, Component: SetupPage },
      { path: 'games/:id', Component: NegotiationPage },
      { path: 'games/:id/debrief', Component: DebriefPage },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
