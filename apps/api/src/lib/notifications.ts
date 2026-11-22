import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppEnv } from '../env.js';
import type { Database, DbExecutor } from '../db/index.js';
import { events, notificationOutbox, users, venueRequests } from '../db/schema.js';
import { startRealtimeNotificationWakeup } from './notification-realtime.js';

interface NotificationInput {
  recipientUserId: string;
  type: string;
  subject: string;
  body: string;
  payload?: Record<string, unknown>;
}

/**
 * Writes a notification to the transactional outbox. Delivery happens later in
 * a separate worker, so an unavailable email/webhook service can never roll back
 * an approval, allotment or cancellation.
 */
export function enqueueNotification(db: DbExecutor, input: NotificationInput) {
  return db.insert(notificationOutbox).values({
    recipientUserId: input.recipientUserId,
    type: input.type,
    subject: input.subject,
    body: input.body,
    payload: input.payload ?? null,
  });
}

export async function notifyRequestParticipants(
  db: DbExecutor,
  requestId: string,
  input: {
    type: string;
    subject: string;
    body: string;
    excludeUserId?: string;
    payload?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .select({
      creatorId: events.creatorId,
      submittedById: venueRequests.submittedById,
      facultyCoordinatorId: events.facultyCoordinatorId,
    })
    .from(venueRequests)
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .where(eq(venueRequests.id, requestId))
    .limit(1);
  if (!row) return;

  const recipients = new Set(
    [row.creatorId, row.submittedById, row.facultyCoordinatorId].filter(
      (id): id is string => Boolean(id) && id !== input.excludeUserId,
    ),
  );
  if (recipients.size === 0) return;

  await db.insert(notificationOutbox).values(
    [...recipients].map((recipientUserId) => ({
      recipientUserId,
      type: input.type,
      subject: input.subject,
      body: input.body,
      payload: { requestId, ...input.payload },
    })),
  );
}

interface ClaimedNotification extends Record<string, unknown> {
  id: string;
  recipientUserId: string | null;
  type: string;
  subject: string;
  body: string;
  payload: Record<string, unknown> | null;
  attempts: number;
}

interface NotificationRecipient {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

async function deliver(
  env: AppEnv,
  logger: FastifyBaseLogger,
  notification: ClaimedNotification,
  recipient: NotificationRecipient,
) {
  if (env.NOTIFICATION_MODE === 'log') {
    logger.info(
      {
        notificationId: notification.id,
        notificationType: notification.type,
        recipient: recipient.email,
      },
      'Notification delivered to application log',
    );
    return;
  }

  if (!env.NOTIFICATION_WEBHOOK_URL) {
    throw new Error('NOTIFICATION_WEBHOOK_URL is not configured.');
  }

  const response = await fetch(env.NOTIFICATION_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.NOTIFICATION_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${env.NOTIFICATION_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      id: notification.id,
      type: notification.type,
      subject: notification.subject,
      body: notification.body,
      payload: notification.payload,
      recipient: {
        id: recipient.id,
        email: recipient.email,
        name: `${recipient.firstName} ${recipient.lastName}`.trim(),
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Notification webhook returned HTTP ${response.status}.`);
  }
}

export async function processNotificationBatch(
  db: Database,
  env: AppEnv,
  logger: FastifyBaseLogger,
) {
  // Recover rows abandoned by a worker crash during delivery.
  await db.execute(sql`
    UPDATE notification_outbox
    SET status = 'PENDING', updated_at = now()
    WHERE status = 'PROCESSING'
      AND updated_at < now() - interval '5 minutes'
  `);

  const claimed = await db.execute<ClaimedNotification>(sql`
    UPDATE notification_outbox AS outbox
    SET status = 'PROCESSING', attempts = outbox.attempts + 1, updated_at = now()
    WHERE outbox.id IN (
      SELECT id
      FROM notification_outbox
      WHERE status = 'PENDING' AND next_attempt_at <= now()
      ORDER BY next_attempt_at, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${env.NOTIFICATION_BATCH_SIZE}
    )
    RETURNING
      outbox.id,
      outbox.recipient_user_id AS "recipientUserId",
      outbox.type,
      outbox.subject,
      outbox.body,
      outbox.payload,
      outbox.attempts
  `);

  const rows = claimed.rows;
  if (rows.length === 0) return { sent: 0, failed: 0 };

  const recipientIds = [
    ...new Set(rows.map((row) => row.recipientUserId).filter((id): id is string => Boolean(id))),
  ];
  const recipients =
    recipientIds.length > 0
      ? await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(users)
          .where(inArray(users.id, recipientIds))
      : [];
  const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]));

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const recipient = row.recipientUserId ? recipientById.get(row.recipientUserId) : undefined;
    try {
      if (!recipient) throw new Error('Notification recipient no longer exists.');
      await deliver(env, logger, row, recipient);
      await db
        .update(notificationOutbox)
        .set({ status: 'SENT', sentAt: new Date(), updatedAt: new Date(), lastError: null })
        .where(eq(notificationOutbox.id, row.id));
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notification delivery failed.';
      const exhausted = row.attempts >= env.NOTIFICATION_MAX_ATTEMPTS;
      const retryDelayMs = Math.min(30_000 * 2 ** Math.max(0, row.attempts - 1), 60 * 60 * 1000);
      await db
        .update(notificationOutbox)
        .set({
          status: exhausted ? 'FAILED' : 'PENDING',
          nextAttemptAt: new Date(Date.now() + retryDelayMs),
          lastError: message.slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(eq(notificationOutbox.id, row.id));
      failed += 1;
      logger.warn(
        { err: error, notificationId: row.id, attempts: row.attempts },
        'Notification delivery failed',
      );
    }
  }

  return { sent, failed };
}

export function startNotificationWorker(db: Database, env: AppEnv, logger: FastifyBaseLogger) {
  let running = false;
  let wakeRequested = false;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (running) {
      wakeRequested = true;
      return;
    }
    running = true;
    try {
      do {
        wakeRequested = false;
        await processNotificationBatch(db, env, logger);
      } while (wakeRequested && !stopped);
    } catch (error) {
      logger.error({ err: error }, 'Notification worker failed');
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), env.NOTIFICATION_POLL_MS);
  timer.unref();
  const stopRealtime = startRealtimeNotificationWakeup(env, logger, () => void tick());

  return () => {
    stopped = true;
    clearInterval(timer);
    stopRealtime?.();
  };
}

