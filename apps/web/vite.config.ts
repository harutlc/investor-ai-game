import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
