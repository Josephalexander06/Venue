import { buildApp } from './app.js';
import { createDatabase } from './db/index.js';
import { env } from './env.js';
const { pool, db } = createDatabase(env.DATABASE_URL);
const app = await buildApp({ db, env });
async function shutdown(signal) {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
}
catch (error) {
    app.log.error(error);
    await pool.end();
    process.exit(1);
}
//# sourceMappingURL=server.js.map