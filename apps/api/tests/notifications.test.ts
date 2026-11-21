import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { parseEnv } from '../src/env.js';
import type { Database } from '../src/db/index.js';
import { notificationOutbox } from '../src/db/schema.js';
import { enqueueNotification, processNotificationBatch } from '../src/lib/notifications.js';
import { createTestUser, getTestDatabase, resetDatabase } from './helpers.js';

let db: Database;
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

beforeAll(() => {
  db = getTestDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

afterAll(() => {
  // The shared pool is closed by the global test setup.
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
});
