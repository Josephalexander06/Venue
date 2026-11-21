import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
export function createDatabase(connectionString, max = 10) {
    const pool = new pg.Pool({ connectionString, max });
    const db = drizzle(pool, { schema });
    return { pool, db };
}
//# sourceMappingURL=index.js.map