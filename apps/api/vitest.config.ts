import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve @investor/shared to its TS sources (the "development" export condition).
  resolve: { conditions: ['development'] },
  ssr: { resolve: { conditions: ['development'] } },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
