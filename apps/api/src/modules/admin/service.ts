import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { DEPARTMENT_SCOPED_ROLES, UNASSIGNED_DEPARTMENT_CODE, type ApproveUserInput } from '@venue/shared';
import type { Database } from '../../db/index.js';
import { departments, roles, userRoles, users } from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { enqueueNotification } from '../../lib/notifications.js';
import { AppError } from '../../lib/errors.js';
import { revokeAllSessions } from '../auth/service.js';
import { findUserView } from '../users/view.js';

interface ActorContext {
  actorId: string;
  ipAddress?: string;
  userAgent?: string;
}

async function requirePendingUser(tx: Parameters<Parameters<Database['transaction']>[0]>[0], userId: string) {
  const [target] = await tx
    .select({ id: users.id, departmentId: users.departmentId, status: users.status, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);

  if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
  if (target.status !== 'PENDING_APPROVAL') {
    throw new AppError(409, 'ACCOUNT_NOT_PENDING', 'This account has already been reviewed.');
  }
  return target;
}

async function replaceRoles(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  userId: string,
  userDepartmentId: string,
  assignments: ApproveUserInput['roles'],
) {
  const requestedNames = [...new Set(assignments.map((assignment) => assignment.role))];
  const roleRows = await tx
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(inArray(roles.name, requestedNames));
  const roleIds = new Map(roleRows.map((role) => [role.name, role.id]));

  if (roleIds.size !== requestedNames.length) {
    throw new AppError(400, 'UNKNOWN_ROLE', 'One of the selected roles does not exist.');
  }

  const normalized = assignments.map((assignment) => {
    const departmentScoped = DEPARTMENT_SCOPED_ROLES.includes(assignment.role);
    const departmentId = departmentScoped
      ? (assignment.departmentId ?? (assignment.role === 'HOD' ? null : userDepartmentId))
      : null;

    if (assignment.role === 'HOD' && departmentId !== userDepartmentId) {
      throw new AppError(
        400,
        'INVALID_HOD_SCOPE',
        'A Head of Department role must be scoped to the user’s own department.',
      );
    }
    return {
      userId,
      roleId: roleIds.get(assignment.role)!,
      departmentId,
      venueId: null,
    };
  });

  const departmentIds = [
    ...new Set(normalized.flatMap((row) => (row.departmentId ? [row.departmentId] : []))),
  ];
  if (departmentIds.length > 0) {
    const existing = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(inArray(departments.id, departmentIds));
    if (existing.length !== departmentIds.length) {
      throw new AppError(400, 'DEPARTMENT_NOT_FOUND', 'One of the selected departments does not exist.');
    }
  }

  await tx.delete(userRoles).where(eq(userRoles.userId, userId));
  await tx.insert(userRoles).values(normalized);
}

export async function approveUser(
  db: Database,
  userId: string,
  input: ApproveUserInput,
  actor: ActorContext,
) {
  await db.transaction(async (tx) => {
    const target = await requirePendingUser(tx, userId);
    const departmentId = input.departmentId ?? target.departmentId;
    const [department] = await tx.select({ code: departments.code }).from(departments)
      .where(eq(departments.id, departmentId)).limit(1);
    if (!department || department.code === UNASSIGNED_DEPARTMENT_CODE) {
      throw new AppError(400, 'DEPARTMENT_REQUIRED', 'Assign the user to a department before approving.');
    }
    await replaceRoles(tx, userId, departmentId, input.roles);
    await tx
      .update(users)
      .set({
        departmentId,
        status: 'ACTIVE',
        statusReason: null,
        approvedBy: actor.actorId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await writeAudit(tx, {
      actorId: actor.actorId,
      action: 'USER_APPROVED',
      entityName: 'users',
      entityId: userId,
      oldState: { status: target.status },
      newState: { status: 'ACTIVE', departmentId, roles: input.roles },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });

  const user = await findUserView(db, userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
  return user;
}

export async function rejectUser(
  db: Database,
  userId: string,
  reason: string,
  actor: ActorContext,
) {
  await db.transaction(async (tx) => {
    const target = await requirePendingUser(tx, userId);
    await tx
      .update(users)
      .set({ status: 'REJECTED', statusReason: reason, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await writeAudit(tx, {
      actorId: actor.actorId,
      action: 'USER_REJECTED',
      entityName: 'users',
      entityId: userId,
      oldState: { status: target.status },
      newState: { status: 'REJECTED', reason },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });

  const user = await findUserView(db, userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
  return user;
}

export async function suspendUser(
  db: Database,
  userId: string,
  reason: string,
  actor: ActorContext,
) {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);

    if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
    if (target.id === actor.actorId) {
      throw new AppError(403, 'SELF_SUSPENSION_FORBIDDEN', 'You cannot suspend your own account.');
    }
    if (target.status !== 'ACTIVE') {
      throw new AppError(409, 'ACCOUNT_NOT_ACTIVE', 'Only active accounts can be suspended.');
    }

    const [remainingAdmins] = await tx
      .select({ value: count() })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          eq(roles.name, 'ADMINISTRATOR'),
          eq(users.status, 'ACTIVE'),
          ne(users.id, userId),
        ),
      );
    if ((remainingAdmins?.value ?? 0) === 0) {
      throw new AppError(
        409,
        'LAST_ADMINISTRATOR',
        'The last active administrator cannot be suspended.',
      );
    }

    await tx
      .update(users)
      .set({ status: 'SUSPENDED', statusReason: reason, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await revokeAllSessions(tx, userId);
    await enqueueNotification(tx, {
      recipientUserId: userId,
      type: 'ACCOUNT_SUSPENDED',
      subject: 'Your Campus Venue account has been suspended',
      body: `An administrator suspended your account. Reason: ${reason}`,
      payload: { reason },
    });
    await writeAudit(tx, {
      actorId: actor.actorId,
      action: 'USER_SUSPENDED',
      entityName: 'users',
      entityId: userId,
      oldState: { status: target.status },
      newState: { status: 'SUSPENDED', reason },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });

  const user = await findUserView(db, userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
  return user;
}

export async function reactivateUser(db: Database, userId: string, actor: ActorContext) {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);

    if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
    if (target.status !== 'SUSPENDED') {
      throw new AppError(409, 'ACCOUNT_NOT_SUSPENDED', 'This account is not suspended.');
    }

    await tx
      .update(users)
      .set({ status: 'ACTIVE', statusReason: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await enqueueNotification(tx, {
      recipientUserId: userId,
      type: 'ACCOUNT_REACTIVATED',
      subject: 'Your Campus Venue account has been reactivated',
      body: 'An administrator reactivated your account. You can sign in again.',
    });
    await writeAudit(tx, {
      actorId: actor.actorId,
      action: 'USER_REACTIVATED',
      entityName: 'users',
      entityId: userId,
      oldState: { status: target.status },
      newState: { status: 'ACTIVE' },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });

  const user = await findUserView(db, userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
  return user;
}

export async function updateUserRoles(
  db: Database,
  userId: string,
  input: ApproveUserInput,
  actor: ActorContext,
) {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id, departmentId: users.departmentId, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);

    if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
    if (target.status !== 'ACTIVE') {
      throw new AppError(409, 'ACCOUNT_NOT_ACTIVE', 'Only active accounts can have roles changed.');
    }

    if (target.id === actor.actorId && !input.roles.some((role) => role.role === 'ADMINISTRATOR')) {
      throw new AppError(
        400,
        'SELF_ROLE_CHANGE',
        'You cannot remove your own administrator role.',
      );
    }

    await replaceRoles(tx, userId, target.departmentId, input.roles);
    await tx.update(users).set({ updatedAt: new Date() }).where(eq(users.id, userId));

    await writeAudit(tx, {
      actorId: actor.actorId,
      action: 'USER_ROLES_UPDATED',
      entityName: 'users',
      entityId: userId,
      oldState: null,
      newState: { roles: input.roles },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });

  const user = await findUserView(db, userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
  return user;
}
