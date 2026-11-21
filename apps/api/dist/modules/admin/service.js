import { eq, inArray } from 'drizzle-orm';
import { DEPARTMENT_SCOPED_ROLES } from '@venue/shared';
import { departments, roles, userRoles, users } from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { findUserView } from '../users/view.js';
async function requirePendingUser(tx, userId) {
    const [target] = await tx
        .select({ id: users.id, departmentId: users.departmentId, status: users.status, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);
    if (!target)
        throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
    if (target.status !== 'PENDING_APPROVAL') {
        throw new AppError(409, 'ACCOUNT_NOT_PENDING', 'This account has already been reviewed.');
    }
    return target;
}
async function replaceRoles(tx, userId, userDepartmentId, assignments) {
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
            throw new AppError(400, 'INVALID_HOD_SCOPE', 'A Head of Department role must be scoped to the user’s own department.');
        }
        return {
            userId,
            roleId: roleIds.get(assignment.role),
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
export async function approveUser(db, userId, input, actor) {
    await db.transaction(async (tx) => {
        const target = await requirePendingUser(tx, userId);
        await replaceRoles(tx, userId, target.departmentId, input.roles);
        await tx
            .update(users)
            .set({
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
            newState: { status: 'ACTIVE', roles: input.roles },
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        });
    });
    const user = await findUserView(db, userId);
    if (!user)
        throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
    return user;
}
export async function rejectUser(db, userId, reason, actor) {
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
    if (!user)
        throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
    return user;
}
export async function updateUserRoles(db, userId, input, actor) {
    await db.transaction(async (tx) => {
        const [target] = await tx
            .select({ id: users.id, departmentId: users.departmentId, status: users.status })
            .from(users)
            .where(eq(users.id, userId))
            .for('update')
            .limit(1);
        if (!target)
            throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
        if (target.status !== 'ACTIVE') {
            throw new AppError(409, 'ACCOUNT_NOT_ACTIVE', 'Only active accounts can have roles changed.');
        }
        if (target.id === actor.actorId && !input.roles.some((role) => role.role === 'ADMINISTRATOR')) {
            throw new AppError(400, 'SELF_ROLE_CHANGE', 'You cannot remove your own administrator role.');
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
    if (!user)
        throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
    return user;
}
//# sourceMappingURL=service.js.map