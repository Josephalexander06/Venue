import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
export function runMigrations(db) {
    return migrate(db, { migrationsFolder });
}
//# sourceMappingURL=migrate.js.map