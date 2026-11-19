import './env.js';
import { createDatabase } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

export async function setup() {
  const { pool, db } = createDatabase(process.env.DATABASE_URL!, 1);
  try {
    await runMigrations(db);
  } finally {
    await pool.end();
  }
}
