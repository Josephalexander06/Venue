import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

export function createDatabase(connectionString: string, max = 10) {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
