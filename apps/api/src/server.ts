import { buildApp } from './app.js';
import { checkDatabaseReadiness, createDatabase } from './db/index.js';
import { env } from './env.js';
import { startNotificationWorker } from './lib/notifications.js';
import { findPostgresError } from './lib/postgres-error.js';
import { cleanupSessions } from './modules/auth/service.js';

const { pool, db } = createDatabase(env.DATABASE_URL);
const app = await buildApp({ db, env });

try {
  await checkDatabaseReadiness(db);
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  const message = findPostgresError(err)?.code === '42P01'
    ? 'Notification outbox is missing. Apply database migrations to the API DATABASE_URL before starting.'
    : 'API startup failed';
  app.log.error({ err }, message);
  await app.close();
  await pool.end();
  process.exit(1);
}

if (env.NODE_ENV === 'production' && env.NOTIFICATION_MODE === 'log') {
  app.log.warn(
    'NOTIFICATION_MODE=log is active in production; notifications will only appear in the API log.',
  );
}

const stopNotificationWorker = startNotificationWorker(db, env, app.log);

async function cleanup() {
  try {
    const deleted = await cleanupSessions(db, env.SESSION_RETENTION_DAYS);
    if (deleted > 0) app.log.info({ deleted }, 'Expired sessions cleaned up');
  } catch (error) {
    app.log.error({ err: error }, 'Session cleanup failed');
  }
}

void cleanup();
const cleanupTimer = setInterval(
  () => void cleanup(),
  env.SESSION_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000,
);
cleanupTimer.unref();

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down');
  stopNotificationWorker();
  clearInterval(cleanupTimer);
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
