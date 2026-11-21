import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { count } from 'drizzle-orm';
import {
  approveUserSchema,
  rejectUserSchema,
  suspendUserSchema,
  updateUserRolesSchema,
  USER_STATUSES,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { parseInput } from '../../lib/validation.js';
import { listUserViews } from '../users/view.js';
import {
  approveUser,
  reactivateUser,
  rejectUser,
  suspendUser,
  updateUserRoles,
} from './service.js';

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

const adminRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const adminOnly = { preHandler: app.requireRole('ADMINISTRATOR' as const) };

  app.get('/stats', adminOnly, async () => {
    const rows = await db
      .select({ status: users.status, value: count() })
      .from(users)
      .groupBy(users.status);
    const counts: Record<string, number> = {
      PENDING_APPROVAL: 0,
      ACTIVE: 0,
      REJECTED: 0,
      SUSPENDED: 0,
    };
    for (const row of rows) counts[row.status] = row.value;
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
      actorId: request.auth!.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { user };
  });

  app.patch('/users/:id/reject', adminOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(rejectUserSchema, request.body);
    const user = await rejectUser(db, id, input.reason, {
      actorId: request.auth!.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { user };
  });

  app.patch('/users/:id/roles', adminOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(updateUserRolesSchema, request.body);
    const user = await updateUserRoles(db, id, input, {
      actorId: request.auth!.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { user };
  });

  app.patch('/users/:id/suspend', adminOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(suspendUserSchema, request.body);
    const user = await suspendUser(db, id, input.reason, {
      actorId: request.auth!.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { user };
  });

  app.patch('/users/:id/reactivate', adminOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const user = await reactivateUser(db, id, {
      actorId: request.auth!.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { user };
  });
};

export default adminRoutes;
