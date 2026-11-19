import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseEnv } from '../src/env.js';
import { buildApp } from '../src/app.js';
import { createSession } from '../src/modules/auth/service.js';
import {
  createTestUser,
  getTestDatabase,
  login,
  mutationHeaders,
  resetDatabase,
} from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    db: getTestDatabase(),
    env: parseEnv(process.env),
    logger: false,
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
});

async function registerApplicant(email = `student-${randomUUID()}@college.edu`) {
  const reference = await resetDatabase();
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      email,
      password: 'StudentPass123!',
      firstName: 'Ada',
      lastName: 'Lovelace',
      departmentId: reference.departments.get('CS')!.id,
    },
  });
  expect(response.statusCode).toBe(201);
  return { email, reference, body: response.json() };
}

async function adminSession() {
  const { user, password } = await createTestUser({
    email: `admin-${randomUUID()}@college.edu`,
    role: 'ADMINISTRATOR',
    departmentCode: 'ADMIN',
  });
  return login(app, user.email, password);
}

describe('registration and account approval', () => {
  it('creates a pending account, blocks login, then allows scoped access after approval', async () => {
    const { email, reference } = await registerApplicant();

    const blockedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'StudentPass123!' },
    });
    expect(blockedLogin.statusCode).toBe(403);
    expect(blockedLogin.json()).toMatchObject({ code: 'ACCOUNT_PENDING_APPROVAL' });

    const admin = await adminSession();
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users/pending',
      headers: { cookie: admin.cookie },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().users).toHaveLength(1);
    expect(pending.json().users[0].email).toBe(email);

    const applicantId = pending.json().users[0].id;
    const approved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${applicantId}/approve`,
      headers: mutationHeaders(admin),
      payload: {
        roles: [{ role: 'STUDENT', departmentId: reference.departments.get('CS')!.id }],
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().user).toMatchObject({
      status: 'ACTIVE',
      roles: [{ role: 'STUDENT', departmentId: reference.departments.get('CS')!.id }],
    });

    const signedIn = await login(app, email, 'StudentPass123!');
    expect(signedIn.user).toMatchObject({
      email,
      status: 'ACTIVE',
      department: { code: 'CS' },
      roles: [{ role: 'STUDENT' }],
    });

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: signedIn.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const { email, reference } = await registerApplicant();
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        password: 'StudentPass123!',
        firstName: 'Ada',
        lastName: 'Lovelace',
        departmentId: reference.departments.get('CS')!.id,
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('EMAIL_IN_USE');

    const weak = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `weak-${randomUUID()}@college.edu`,
        password: 'short',
        firstName: 'Ada',
        lastName: 'Lovelace',
        departmentId: reference.departments.get('CS')!.id,
      },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().code).toBe('VALIDATION_ERROR');
  });

  it('rejects a pending account with a reason and keeps it out of active login', async () => {
    const { email } = await registerApplicant();
    const admin = await adminSession();
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users/pending',
      headers: { cookie: admin.cookie },
    });
    const id = pending.json().users[0].id;

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${id}/reject`,
      headers: mutationHeaders(admin),
      payload: { reason: 'College ID could not be verified.' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().user.status).toBe('REJECTED');

    const loginAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'StudentPass123!' },
    });
    expect(loginAttempt.statusCode).toBe(403);
    expect(loginAttempt.json().code).toBe('ACCOUNT_REJECTED');
  });

  it('requires HOD scope to match the user department', async () => {
    const { reference } = await registerApplicant();
    const admin = await adminSession();
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users/pending',
      headers: { cookie: admin.cookie },
    });
    const id = pending.json().users[0].id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${id}/approve`,
      headers: mutationHeaders(admin),
      payload: { roles: [{ role: 'HOD', departmentId: reference.departments.get('ME')!.id }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_HOD_SCOPE');
  });

  it('rejects authenticated mutations without a CSRF header', async () => {
    const { email } = await registerApplicant();
    const admin = await adminSession();
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users/pending',
      headers: { cookie: admin.cookie },
    });
    const id = pending.json().users[0].id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${id}/approve`,
      headers: { cookie: admin.cookie },
      payload: { roles: [{ role: 'STUDENT' }] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('CSRF_TOKEN_INVALID');
    expect(email).toBeTruthy();
  });
});

describe('authorization guards', () => {
  it('denies admin routes to non-administrators', async () => {
    const { user, password } = await createTestUser({
      email: `faculty-${randomUUID()}@college.edu`,
      role: 'FACULTY',
      departmentCode: 'CS',
    });
    const session = await login(app, user.email, password);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  });

  it('rejects an existing session as soon as the account is no longer active', async () => {
    const { user } = await createTestUser({
      email: `pending-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      status: 'PENDING_APPROVAL',
      departmentCode: 'CS',
    });
    const session = await createSession(getTestDatabase(), user.id, 1, {});

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `venue_session=${session.token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('ACCOUNT_NOT_ACTIVE');
  });

  it('lets an administrator update roles for an active account', async () => {
    const { user, password } = await createTestUser({
      email: `promote-${randomUUID()}@college.edu`,
      role: 'STUDENT',
      departmentCode: 'CS',
    });
    const memberSession = await login(app, user.email, password);
    const admin = await adminSession();
    const result = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${user.id}/roles`,
      headers: mutationHeaders(admin),
      payload: { roles: [{ role: 'FACULTY', departmentId: user.departmentId }] },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().user.roles).toEqual([{ role: 'FACULTY', departmentId: user.departmentId, venueId: null }]);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: memberSession.cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.roles[0].role).toBe('FACULTY');
  });
});
