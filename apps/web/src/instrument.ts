// Imported first by main.tsx, so Sentry is initialised before any other app code runs.
import * as Sentry from '@sentry/react';
import { useEffect } from 'react';
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router';

Sentry.init({
  // Unset DSN disables the SDK, so local runs and tests without one send nothing.
  dsn: (import.meta.env.VITE_SENTRY_DSN as string | undefined) || undefined,
  environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
  release: (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) || undefined,
  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
  integrations: [
    // Names page loads and navigations by route pattern (games/:id), not by raw URL.
    Sentry.reactRouterV7BrowserTracingIntegration({
      useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  // 100% in development, lower in production. The API is same-origin (/api), which the default
  // trace propagation already covers, so browser and API spans join into one trace.
  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
