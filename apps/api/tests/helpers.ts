import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ROLE_LABELS, ROLE_NAMES, type RoleName } from '@venue/shared';
import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { createDatabase, type Database } from '../src/db/index.js';
import { departments, roles, userRoles, users } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/password.js';

let connection: ReturnType<typeof createDatabase> | undefined;

export function getTestDatabase(): Database {
  connection ??= createDatabase(process.env.DATABASE_URL!, 5);
  return connection.db;
}

export async function closeTestDatabase() {
  if (connection) {
    await connection.pool.end();
    connection = undefined;
  }
}

export async function resetDatabase() {
  const db = getTestDatabase();
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs,
      notification_outbox,
      sessions,
      approval_decisions,
      approval_instances,
      venue_allotments,
      venue_requests,
      event_organizers,
      events,
      user_roles,
      users,
      workflow_steps,
      approval_workflows,
      venues,
      roles,
      departments
    RESTART IDENTITY CASCADE
  `);

  await db.insert(departments).values([
    { code: 'ADMIN', name: 'College Administration' },
    { code: 'CS', name: 'Computer Science' },
    { code: 'ME', name: 'Mechanical Engineering' },
  ]);
  await db
    .insert(roles)
    .values(ROLE_NAMES.map((name) => ({ name, description: ROLE_LABELS[name] })));

  const departmentRows = await db.select().from(departments);
  const roleRows = await db.select().from(roles);
  return {
    departments: new Map(departmentRows.map((row) => [row.code, row])),
    roles: new Map(roleRows.map((row) => [row.name, row])),
  };
}

interface CreateUserOptions {
  email?: string;
  password?: string;
  role?: RoleName;
  departmentCode?: string;
  status?: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';
}

export async function createTestUser(options: CreateUserOptions = {}) {
  const db = getTestDatabase();
  const email = options.email ?? `user-${randomUUID()}@college.edu`;
  const password = options.password ?? 'CorrectHorse123!';
  const [department] = await db
    .select()
    .from(departments)
    .where(sql`${departments.code} = ${options.departmentCode ?? 'CS'}`)
    .limit(1);
  if (!department) throw new Error('Department fixture missing');

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(password),
      firstName: 'Test',
      lastName: 'User',
      departmentId: department.id,
      status: options.status ?? 'ACTIVE',
      approvedAt: options.status === 'ACTIVE' || !options.status ? new Date() : null,
    })
    .returning();

  const roleName = options.role ?? 'ADMINISTRATOR';
  if (roleName) {
    const [role] = await db.select().from(roles).where(sql`${roles.name} = ${roleName}`).limit(1);
    if (!role) throw new Error('Role fixture missing');
    await db.insert(userRoles).values({
      userId: user!.id,
      roleId: role.id,
      departmentId:
        roleName === 'ADMINISTRATOR' || roleName === 'BURSAR' || roleName === 'PRINCIPAL'
          ? null
          : department.id,
    });
  }

  return { user: user!, password, department };
}

export interface TestSession {
  cookie: string;
  csrfToken: string;
  user: Record<string, unknown>;
}

function extractCookies(response: LightMyRequestResponse) {
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  return values.map((value) => value.split(';')[0]).filter(Boolean) as string[];
}

export async function login(app: FastifyInstance, email: string, password: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Login failed (${response.statusCode}): ${response.body}`);
  }
  const body = response.json<{ user: Record<string, unknown>; csrfToken: string }>();
  return {
    cookie: extractCookies(response).join('; '),
    csrfToken: body.csrfToken,
    user: body.user,
  } satisfies TestSession;
}

export function mutationHeaders(session: TestSession) {
  return { cookie: session.cookie, 'x-csrf-token': session.csrfToken };
}
