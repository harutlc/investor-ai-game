import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/postgres.ts',
  out: './src/db/migrations/postgres',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://localhost:5432/game',
  },
});
