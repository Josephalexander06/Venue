import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';
import type { Database } from '../src/db/index.js';
import { notificationOutbox } from '../src/db/schema.js';
import { enqueueNotification, processNotificationBatch } from '../src/lib/notifications.js';
import { createTestUser, getTestDatabase, login, mutationHeaders, resetDatabase } from './helpers.js';

let db: Database;
let app: FastifyInstance;
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

beforeAll(async () => {
  db = getTestDatabase();
  app = await buildApp({ db, env: parseEnv(process.env), logger: false });
});

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

afterAll(async () => {
  await app.close();
});

describe('transactional notification outbox', () => {
  it('marks a notification sent through the configured log channel', async () => {
    const { user } = await createTestUser({
      email: `notify-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      departmentCode: 'CS',
    });
    await enqueueNotification(db, {
      recipientUserId: user.id,
      type: 'TEST_NOTIFICATION',
      subject: 'Test notification',
      body: 'This is a test.',
    });

    const env = parseEnv({ ...process.env, NOTIFICATION_MODE: 'log' });
    const result = await processNotificationBatch(db, env, logger);
    expect(result).toEqual({ sent: 1, failed: 0 });

    const [row] = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientUserId, user.id));
    expect(row?.status).toBe('SENT');
    expect(row?.sentAt).toBeInstanceOf(Date);
    expect(logger.info).toHaveBeenCalled();
  });

  it('keeps delivery failures in the outbox instead of failing the caller', async () => {
    const { user } = await createTestUser({
      email: `notify-fail-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      departmentCode: 'CS',
    });
    await enqueueNotification(db, {
      recipientUserId: user.id,
      type: 'TEST_NOTIFICATION',
      subject: 'Test notification',
      body: 'This is a test.',
    });

    const env = parseEnv({
      ...process.env,
      NOTIFICATION_MODE: 'webhook',
      NOTIFICATION_WEBHOOK_URL: 'http://127.0.0.1:1/notify',
      NOTIFICATION_MAX_ATTEMPTS: '1',
    });
    const result = await processNotificationBatch(db, env, logger);
    expect(result).toEqual({ sent: 0, failed: 1 });

    const [row] = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientUserId, user.id));
    expect(row?.status).toBe('FAILED');
    expect(row?.lastError).toBeTruthy();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('provides administrative monitoring and recovery for failed outbox notifications', async () => {
    const adminUser = await createTestUser({
      email: `admin-notify-${randomUUID()}@college.edu`,
      role: 'ADMINISTRATOR',
      departmentCode: 'ADMIN',
    });
    const adminSession = await login(app, adminUser.user.email, adminUser.password);

    const { user } = await createTestUser({
      email: `notify-recov-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      departmentCode: 'CS',
    });
    await enqueueNotification(db, {
      recipientUserId: user.id,
      type: 'RECOVERY_TEST',
      subject: 'Failed notification test',
      body: 'Will fail and be recovered.',
    });

    // 1. Induce failure to transition status to FAILED
    const failEnv = parseEnv({
      ...process.env,
      NOTIFICATION_MODE: 'webhook',
      NOTIFICATION_WEBHOOK_URL: 'http://127.0.0.1:1/nonexistent',
      NOTIFICATION_MAX_ATTEMPTS: '1',
    });
    await processNotificationBatch(db, failEnv, logger);

    const [failedRow] = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipientUserId, user.id));
    expect(failedRow?.status).toBe('FAILED');

    // 2. Admin queries failed notifications endpoint
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications/failed',
      headers: { cookie: adminSession.cookie },
    });
    expect(listRes.statusCode).toBe(200);
    const { failedNotifications } = listRes.json();
    expect(failedNotifications.some((n: { id: string }) => n.id === failedRow!.id)).toBe(true);

    // 3. Admin calls single notification retry endpoint
    const retryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${failedRow!.id}/retry`,
      headers: mutationHeaders(adminSession),
    });
    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().success).toBe(true);

    const [retriedRow] = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, failedRow!.id));
    expect(retriedRow?.status).toBe('PENDING');
    expect(retriedRow?.attempts).toBe(0);

    // 4. Batch retry endpoint works
    await db
      .update(notificationOutbox)
      .set({ status: 'FAILED' })
      .where(eq(notificationOutbox.id, failedRow!.id));

    const retryAllRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/notifications/retry-all',
      headers: mutationHeaders(adminSession),
    });
    expect(retryAllRes.statusCode).toBe(200);
    expect(retryAllRes.json().retriedCount).toBeGreaterThanOrEqual(1);

    // 5. Worker delivers the recovered notification successfully
    const successEnv = parseEnv({ ...process.env, NOTIFICATION_MODE: 'log' });
    const batchResult = await processNotificationBatch(db, successEnv, logger);
    expect(batchResult.sent).toBeGreaterThanOrEqual(1);

    const [finalRow] = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.id, failedRow!.id));
    expect(finalRow?.status).toBe('SENT');
  });
});
