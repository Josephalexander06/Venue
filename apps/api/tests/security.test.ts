import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';
import { createDatabase, type Database } from '../src/db/index.js';
import {
  approvalWorkflows,
  departments,
  sessions,
  venues,
  workflowSteps,
} from '../src/db/schema.js';
import { cleanupSessions, createSession } from '../src/modules/auth/service.js';
import { hashToken } from '../src/lib/tokens.js';
import {
  createTestUser,
  getTestDatabase,
  login,
  mutationHeaders,
  resetDatabase,
} from './helpers.js';

let app: FastifyInstance;
let db: Database;

beforeAll(async () => {
  db = getTestDatabase();
  app = await buildApp({ db, env: parseEnv(process.env), logger: false });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function defaultWorkflow() {
  const [workflow] = await db
    .insert(approvalWorkflows)
    .values({ name: `Security workflow ${randomUUID()}`, isDefault: true })
    .returning();
  await db.insert(workflowSteps).values({
    workflowId: workflow!.id,
    stepOrder: 1,
    stepName: 'Department HOD review',
    requiredRole: 'HOD',
    scopeType: 'CREATOR_DEPARTMENT',
    isFinalAllotmentStep: true,
  });
  return workflow!;
}

async function adminSession() {
  const { user, password } = await createTestUser({
    email: `admin-${randomUUID()}@college.edu`,
    role: 'ADMINISTRATOR',
    departmentCode: 'ADMIN',
  });
  return { ...(await login(app, user.email, password)), userId: user.id };
}

describe('production security controls', () => {
  it('sets API security headers and exposes liveness and readiness checks', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['content-security-policy']).toContain("default-src 'none'");
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['referrer-policy']).toBe('no-referrer');

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });
  });

  it('reports not ready when PostgreSQL connects but the outbox is missing from the search path', async () => {
    const env = parseEnv(process.env);
    const { pool, db: isolated } = createDatabase(env.DATABASE_URL, 1);
    try {
      await isolated.execute(sql`set search_path to pg_catalog`);
      const scopedApp = await buildApp({ db: isolated, env, logger: false });
      try {
        const live = await scopedApp.inject({ method: 'GET', url: '/health/live' });
        expect(live.statusCode).toBe(200);
        const ready = await scopedApp.inject({ method: 'GET', url: '/health/ready' });
        expect(ready.statusCode).toBe(503);
        expect(ready.json()).toEqual({ status: 'not_ready' });
      } finally {
        await scopedApp.close();
      }
    } finally {
      await pool.end();
    }
  });

  it('requires the CSRF header to revoke a session on logout', async () => {
    const { user, password } = await createTestUser({
      email: `logout-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      departmentCode: 'CS',
    });
    const session = await login(app, user.email, password);

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: session.cookie },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('CSRF_TOKEN_INVALID');

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: mutationHeaders(session),
    });
    expect(loggedOut.statusCode).toBe(204);
  });

  it('suspends an account, revokes existing sessions and allows reactivation', async () => {
    const admin = await adminSession();
    const { user, password } = await createTestUser({
      email: `suspend-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      departmentCode: 'CS',
    });
    const member = await login(app, user.email, password);

    const selfSuspend = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${admin.userId}/suspend`,
      headers: mutationHeaders(admin),
      payload: { reason: 'Testing self suspension.' },
    });
    expect(selfSuspend.statusCode).toBe(403);
    expect(selfSuspend.json().code).toBe('SELF_SUSPENSION_FORBIDDEN');

    const suspended = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${user.id}/suspend`,
      headers: mutationHeaders(admin),
      payload: { reason: 'Account activity is under review.' },
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().user.status).toBe('SUSPENDED');

    const revoked = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: member.cookie },
    });
    expect(revoked.statusCode).toBe(401);

    const blockedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: user.email, password },
    });
    expect(blockedLogin.statusCode).toBe(403);
    expect(blockedLogin.json().code).toBe('ACCOUNT_SUSPENDED');

    const reactivated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${user.id}/reactivate`,
      headers: mutationHeaders(admin),
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().user.status).toBe('ACTIVE');

    await expect(login(app, user.email, password)).resolves.toMatchObject({
      user: { email: user.email, status: 'ACTIVE' },
    });
  });

  it('applies role reductions to an existing session immediately', async () => {
    const admin = await adminSession();
    const { user, password } = await createTestUser({
      email: `hod-${randomUUID()}@college.edu`,
      role: 'HOD',
      departmentCode: 'CS',
    });
    const member = await login(app, user.email, password);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/inbox',
      headers: { cookie: member.cookie },
    });
    expect(allowed.statusCode).toBe(200);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${user.id}/roles`,
      headers: mutationHeaders(admin),
      payload: { roles: [{ role: 'STUDENT', departmentId: user.departmentId }] },
    });
    expect(updated.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/inbox',
      headers: { cookie: member.cookie },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('FORBIDDEN');
  });

  it('does not expose competing-request details to an unrelated account', async () => {
    await defaultWorkflow();
    const [department] = await db
      .select()
      .from(departments)
      .where(eq(departments.code, 'CS'))
      .limit(1);
    const [venue] = await db
      .insert(venues)
      .values({
        code: `SEC-${randomUUID().slice(0, 8)}`,
        name: 'Security Hall',
        building: 'Main Block',
        capacity: 100,
        setupBufferMins: 0,
        teardownBufferMins: 0,
        departmentId: department!.id,
      })
      .returning();

    const { user: student, password: studentPassword } = await createTestUser({
      email: `owner-${randomUUID()}@college.edu`,
      role: 'FACULTY',
      departmentCode: 'CS',
    });
    const owner = await login(app, student.email, studentPassword);
    const eventResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(owner),
      payload: { title: 'Security review event', expectedAttendance: 20 },
    });
    expect(eventResponse.statusCode).toBe(201);
    const eventId = eventResponse.json().event.id as string;
    const requestResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(owner),
      payload: {
        eventId,
        venueId: venue!.id,
        startTime: '2027-02-01T10:00:00Z',
        endTime: '2027-02-01T11:00:00Z',
      },
    });
    expect(requestResponse.statusCode).toBe(201);
    const requestId = requestResponse.json().request.id as string;

    const { user: outsider, password: outsiderPassword } = await createTestUser({
      email: `outsider-${randomUUID()}@college.edu`,
      role: 'FACULTY',
      departmentCode: 'ME',
    });
    const outsiderSession = await login(app, outsider.email, outsiderPassword);
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/allotments/competing/${requestId}`,
      headers: { cookie: outsiderSession.cookie },
    });
    expect(denied.statusCode).toBe(404);

    const { user: hod, password: hodPassword } = await createTestUser({
      email: `hod-${randomUUID()}@college.edu`,
      role: 'HOD',
      departmentCode: 'CS',
    });
    const hodSession = await login(app, hod.email, hodPassword);
    const allowed = await app.inject({
      method: 'GET',
      url: `/api/v1/allotments/competing/${requestId}`,
      headers: { cookie: hodSession.cookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().targetRequestId).toBe(requestId);
  });

  it('deletes expired and revoked sessions during maintenance', async () => {
    const { user } = await createTestUser({
      email: `cleanup-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      departmentCode: 'CS',
    });
    const session = await createSession(db, user.id, 1, {});
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ expiresAt: old, revokedAt: old })
      .where(eq(sessions.tokenHash, hashToken(session.token)));

    const deleted = await cleanupSessions(db, 7);
    expect(deleted).toBe(1);
  });

  it('exposes admin maintenance endpoint to reliably purge expired sessions', async () => {
    const admin = await adminSession();
    const { user } = await createTestUser({
      email: `maint-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      departmentCode: 'CS',
    });
    const session = await createSession(db, user.id, 1, {});
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ expiresAt: old, revokedAt: old })
      .where(eq(sessions.tokenHash, hashToken(session.token)));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/maintenance/sessions',
      headers: mutationHeaders(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBeGreaterThanOrEqual(1);
  });

  it('mitigates client IP spoofing behind a reverse proxy with trustProxy: 1', async () => {
    const proxyApp = await buildApp({
      db,
      env: parseEnv({ ...process.env, TRUST_PROXY: 'true' }),
      logger: false,
    });
    try {
      proxyApp.get('/test-ip', (req) => ({ ip: req.ip }));
      // Client sends forged X-Forwarded-For: forged, proxy_hop
      const res = await proxyApp.inject({
        method: 'GET',
        url: '/test-ip',
        headers: {
          'x-forwarded-for': '203.0.113.195, 198.51.100.1',
        },
      });
      expect(res.statusCode).toBe(200);
      // Fastify with trustProxy: 1 trusts only 1 hop and selects 198.51.100.1, rejecting the spoofed 203.0.113.195
      expect(res.json().ip).toBe('198.51.100.1');
    } finally {
      await proxyApp.close();
    }
  });
});
