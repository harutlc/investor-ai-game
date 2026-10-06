import { fileURLToPath } from 'node:url';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = 'http://localhost:3001';

// Set only in the production image build (a BuildKit secret, see the Dockerfile): source maps are then
// emitted hidden, uploaded to Sentry for the release, and deleted so nginx never serves them.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: 'harut-46',
            project: 'investor-web',
            authToken: sentryAuthToken,
            ...(process.env.VITE_SENTRY_RELEASE
              ? { release: { name: process.env.VITE_SENTRY_RELEASE } }
              : {}),
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Bundle @investor/shared from its TS sources (its "development" export), so the web app never
      // depends on a built shared/dist. An alias rather than a global condition keeps other packages on
      // their production builds.
      '@investor/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  build: {
    // One ~630 kB (~195 kB gzip) bundle: react-dom, zod (the shared schemas validate every response) and
    // react-router are most of it. Fine for a single-screen game, so the default 500 kB warning is raised.
    chunkSizeWarningLimit: 700,
    sourcemap: sentryAuthToken ? 'hidden' : false,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin /api in development: the player cookie stays first-party and POSTs need no preflight.
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
  preview: {
    port: 5173,
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
});
