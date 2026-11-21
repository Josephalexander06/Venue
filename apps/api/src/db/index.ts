import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

export function createDatabase(connectionString: string, max = 10) {
  const pool = new pg.Pool({ connectionString, max, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export async function checkDatabaseReadiness(db: Database) {
  // Resolve the outbox on the same search path as the worker without reading rows.
  await db.execute(sql`select 1 from ${schema.notificationOutbox} limit 0`);
}
