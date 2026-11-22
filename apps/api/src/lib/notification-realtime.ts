import { createRealtime, rawSql, type RawSqlQuery, type RealtimeDirectServer } from '@neon/realtime/server';
import type { LiveQuerySnapshot } from '@neon/realtime/client';
import type { FastifyBaseLogger } from 'fastify';
import type { AppEnv } from '../env.js';

interface PendingNotification {
  id: string;
  next_attempt_at: string;
}

const nextNotification = rawSql<PendingNotification>(`
  SELECT id, next_attempt_at
  FROM public.notification_outbox
  WHERE status = 'PENDING'
  ORDER BY next_attempt_at, created_at, id
  LIMIT 1
`);

export function startRealtimeNotificationWakeup(env: AppEnv, logger: FastifyBaseLogger, wake: () => void) {
  if (!env.NEON_REALTIME_URL || !env.NEON_REALTIME_SECRET) return;

  let realtime: RealtimeDirectServer<RawSqlQuery<unknown>>;
  try {
    const database = new URL(env.DATABASE_URL);
    realtime = createRealtime({
      url: env.NEON_REALTIME_URL,
      secret: env.NEON_REALTIME_SECRET,
      db: decodeURIComponent(database.pathname.slice(1)),
    });
  } catch {
    logger.warn('Neon Realtime could not initialize. Notification polling is active.');
    return;
  }

  let stopped = false;
  let retryTimer: NodeJS.Timeout | undefined;

  function retry(code: string) {
    if (stopped || retryTimer) return;
    logger.warn({ code }, 'Neon Realtime notification subscription failed. Notification polling is active.');
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void subscribe();
    }, 30_000);
    retryTimer.unref();
  }

  async function subscribe() {
    try {
      const subscription = await realtime.subscribe(nextNotification);
      if (stopped) {
        subscription.unsubscribe();
        return;
      }

      let live = false;
      function observe(snapshot: LiveQuerySnapshot<PendingNotification>) {
        if (snapshot.status === 'error') {
          subscription.unsubscribe();
          retry(snapshot.error.code);
          return;
        }
        if (snapshot.status === 'live' && !live) {
          logger.info('Neon Realtime notification subscription is live');
        }
        live = snapshot.status === 'live';
        if (live && snapshot.data?.length) wake();
      }

      subscription.onChange(observe);
      observe(subscription.getSnapshot());
    } catch {
      retry('subscribe_failed');
    }
  }

  void subscribe();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    realtime.close();
  };
}
