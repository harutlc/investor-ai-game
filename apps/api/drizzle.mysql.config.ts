import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema/mysql.ts',
  out: './src/db/migrations/mysql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'mysql://localhost:3306/game',
  },
});
