import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/sqlite.ts',
  out: './src/db/migrations/sqlite',
  dbCredentials: {
    url: process.env.DATABASE_FILE || '../../data/game.sqlite',
  },
});
