import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './index.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function runMigrations(db: Database) {
  return migrate(db, { migrationsFolder });
}
