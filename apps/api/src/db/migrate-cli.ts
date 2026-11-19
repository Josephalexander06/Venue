import { env } from '../env.js';
import { createDatabase } from './index.js';
import { runMigrations } from './migrate.js';

const { pool, db } = createDatabase(env.DATABASE_URL, 1);

try {
  await runMigrations(db);
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
