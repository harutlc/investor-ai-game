import './instrument';
import { reactErrorHandler } from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';


// React reports componentStack as possibly undefined; Sentry's handler (React's ErrorInfo) wants null.
const sentryErrorHandler = reactErrorHandler();
const reportToSentry = (error: unknown, info: { componentStack?: string | undefined }) =>
  sentryErrorHandler(error, { componentStack: info.componentStack ?? null });

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root, {
  onUncaughtError: reportToSentry,
  onCaughtError: reportToSentry,
  onRecoverableError: reportToSentry,
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
