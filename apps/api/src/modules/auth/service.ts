import { and, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { UNASSIGNED_DEPARTMENT_CODE, type SessionUser, type UserStatus } from '@venue/shared';
import type { Database, DbExecutor } from '../../db/index.js';
import { departments, sessions, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { hashToken, newOpaqueToken } from '../../lib/tokens.js';
import { writeAudit } from '../../lib/audit.js';
import { findUserView, type UserView } from '../users/view.js';

const INVALID_CREDENTIALS = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');

let dummyHash: Promise<string> | undefined;

async function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword('not-a-real-account-password-1');
  await verifyPassword(await dummyHash, password);
}

export async function registerUser(
  db: Database,
  input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    departmentId?: string;
  },
  context: { ipAddress?: string; userAgent?: string },
) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    if (!input.departmentId) {
      await tx.insert(departments).values({
        code: UNASSIGNED_DEPARTMENT_CODE,
        name: 'Awaiting department assignment',
      }).onConflictDoNothing({ target: departments.code });
    }
    const [department] = await tx.select({ id: departments.id }).from(departments)
      .where(input.departmentId
        ? eq(departments.id, input.departmentId)
        : eq(departments.code, UNASSIGNED_DEPARTMENT_CODE)).limit(1);
    if (!department) throw new AppError(400, 'DEPARTMENT_NOT_FOUND', 'Choose a valid department.');

    const [created] = await tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone || null,
        departmentId: department.id,
      })
      .returning({ id: users.id, email: users.email, status: users.status, createdAt: users.createdAt });

    if (!created) throw new Error('User insert returned no row.');

    await writeAudit(tx, {
      actorId: null,
      action: 'USER_REGISTERED',
      entityName: 'users',
      entityId: created.id,
      newState: { email: created.email, status: created.status },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return created;
  });
}

export async function authenticateCredentials(
  db: Database,
  email: string,
  password: string,
  allowPending = false,
): Promise<UserView> {
  const [account] = await db
    .select({ id: users.id, status: users.status, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!account) {
    await verifyAgainstDummy(password);
    throw INVALID_CREDENTIALS();
  }

  const passwordMatches = await verifyPassword(account.passwordHash, password);
  if (!passwordMatches) throw INVALID_CREDENTIALS();

  if (account.status !== 'ACTIVE' && !(allowPending && account.status === 'PENDING_APPROVAL')) {
    throw accountStatusError(account.status);
  }

  const user = await findUserView(db, account.id);
  if (!user) throw INVALID_CREDENTIALS();
  return user;
}

function accountStatusError(status: UserStatus) {
  switch (status) {
    case 'PENDING_APPROVAL':
      return new AppError(
        403,
        'ACCOUNT_PENDING_APPROVAL',
        'Your account is awaiting administrator approval.',
      );
    case 'REJECTED':
      return new AppError(403, 'ACCOUNT_REJECTED', 'Your registration was not approved.');
    case 'SUSPENDED':
      return new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account is suspended.');
    default:
      return new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Your account is not active.');
  }
}

export const PENDING_SESSION_PREFIX = 'pending.';

export async function createSession(
  db: Database,
  userId: string,
  ttlHours: number,
  context: { ipAddress?: string; userAgent?: string },
  pending = false,
) {
  const token = (pending ? PENDING_SESSION_PREFIX : '') + newOpaqueToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });
  return { token, expiresAt };
}

export interface AuthenticatedSession {
  sessionId: string;
  tokenHash: string;
  user: SessionUser;
}

export async function resolveSession(
  db: Database,
  token: string,
): Promise<AuthenticatedSession | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;
  const user = await findUserView(db, row.userId);
  if (!user) return null;
  return { sessionId: row.id, tokenHash, user };
}

export async function revokeSession(db: DbExecutor, tokenHash: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

export async function revokeAllSessions(db: DbExecutor, userId: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function cleanupSessions(db: Database, retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, cutoff),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, cutoff)),
      ),
    )
    .returning({ id: sessions.id });
  return deleted.length;
}
