import { z } from 'zod';
import { and, count, desc, eq } from 'drizzle-orm';
import { approveUserSchema, rejectUserSchema, suspendUserSchema, updateUserRolesSchema, USER_STATUSES, } from '@venue/shared';
import { notificationOutbox, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { parseInput } from '../../lib/validation.js';
import { cleanupSessions } from '../auth/service.js';
import { listUserViews } from '../users/view.js';
import { approveUser, reactivateUser, rejectUser, suspendUser, updateUserRoles, } from './service.js';
const listQuerySchema = z.object({
    status: z.enum(USER_STATUSES).optional(),
    search: z
        .string()
        .trim()
        .max(100)
        .optional()
        .transform((value) => value || undefined),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});
const idParamsSchema = z.object({ id: z.string().uuid() });
const adminRoutes = async (app, { db }) => {
    const adminOnly = { preHandler: app.requireRole('ADMINISTRATOR') };
    app.get('/stats', adminOnly, async () => {
        const rows = await db
            .select({ status: users.status, value: count() })
            .from(users)
            .groupBy(users.status);
        const counts = {
            PENDING_APPROVAL: 0,
            ACTIVE: 0,
            REJECTED: 0,
            SUSPENDED: 0,
        };
        for (const row of rows)
            counts[row.status] = row.value;
        const recent = await listUserViews(db, {
            status: 'PENDING_APPROVAL',
            limit: 5,
            offset: 0,
        });
        return { counts, recentPending: recent.users };
    });
    app.get('/users', adminOnly, async (request) => {
        const query = parseInput(listQuerySchema, request.query);
        return listUserViews(db, query);
    });
    app.get('/users/pending', adminOnly, async () => {
        const result = await listUserViews(db, {
            status: 'PENDING_APPROVAL',
            limit: 100,
            offset: 0,
        });
        return { users: result.users };
    });
    app.patch('/users/:id/approve', adminOnly, async (request) => {
        const { id } = parseInput(idParamsSchema, request.params);
        const input = parseInput(approveUserSchema, request.body);
        const user = await approveUser(db, id, input, {
            actorId: request.auth.user.id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
        });
        return { user };
    });
    app.patch('/users/:id/reject', adminOnly, async (request) => {
        const { id } = parseInput(idParamsSchema, request.params);
        const input = parseInput(rejectUserSchema, request.body);
        const user = await rejectUser(db, id, input.reason, {
            actorId: request.auth.user.id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
        });
        return { user };
    });
    app.patch('/users/:id/roles', adminOnly, async (request) => {
        const { id } = parseInput(idParamsSchema, request.params);
        const input = parseInput(updateUserRolesSchema, request.body);
        const user = await updateUserRoles(db, id, input, {
            actorId: request.auth.user.id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
        });
        return { user };
    });
    app.patch('/users/:id/suspend', adminOnly, async (request) => {
        const { id } = parseInput(idParamsSchema, request.params);
        const input = parseInput(suspendUserSchema, request.body);
        const user = await suspendUser(db, id, input.reason, {
            actorId: request.auth.user.id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
        });
        return { user };
    });
    app.patch('/users/:id/reactivate', adminOnly, async (request) => {
        const { id } = parseInput(idParamsSchema, request.params);
        const user = await reactivateUser(db, id, {
            actorId: request.auth.user.id,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
        });
        return { user };
    });
    app.post('/maintenance/sessions', adminOnly, async () => {
        const deleted = await cleanupSessions(db, 7);
        return { deleted };
    });
    app.get('/notifications/failed', adminOnly, async () => {
        const failedRows = await db
            .select({
            id: notificationOutbox.id,
            recipientUserId: notificationOutbox.recipientUserId,
            type: notificationOutbox.type,
            subject: notificationOutbox.subject,
            attempts: notificationOutbox.attempts,
            lastError: notificationOutbox.lastError,
            createdAt: notificationOutbox.createdAt,
            updatedAt: notificationOutbox.updatedAt,
        })
            .from(notificationOutbox)
            .where(eq(notificationOutbox.status, 'FAILED'))
            .orderBy(desc(notificationOutbox.updatedAt))
            .limit(100);
        return { failedNotifications: failedRows };
    });
    app.post('/notifications/:id/retry', adminOnly, async (request) => {
        const { id } = parseInput(idParamsSchema, request.params);
        const [updated] = await db
            .update(notificationOutbox)
            .set({
            status: 'PENDING',
            attempts: 0,
            nextAttemptAt: new Date(),
            updatedAt: new Date(),
        })
            .where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'FAILED')))
            .returning({ id: notificationOutbox.id });
        if (!updated) {
            throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Failed notification not found.');
        }
        return { success: true, notificationId: updated.id };
    });
    app.post('/notifications/retry-all', adminOnly, async () => {
        const retried = await db
            .update(notificationOutbox)
            .set({
            status: 'PENDING',
            attempts: 0,
            nextAttemptAt: new Date(),
            updatedAt: new Date(),
        })
            .where(eq(notificationOutbox.status, 'FAILED'))
            .returning({ id: notificationOutbox.id });
        return { retriedCount: retried.length };
    });
};
export default adminRoutes;
//# sourceMappingURL=routes.js.map