import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, countDistinct, eq, ne, sql } from 'drizzle-orm';
import {
  UNASSIGNED_DEPARTMENT_CODE,
  departmentInputSchema,
  departmentUpdateSchema,
  type SessionUser,
  type DepartmentInput,
  type DepartmentUpdateInput,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import {
  departments,
  events,
  users,
  venues,
} from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { parseInput } from '../../lib/validation.js';
import { listFacultyCandidates } from '../events/service.js';
import { listUserViews } from '../users/view.js';
import { listVenues } from '../venues/service.js';

const departmentParams = z.object({ id: z.string().uuid() });
const directoryQuery = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(18),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function requireDepartmentHead(user: SessionUser, departmentId: string) {
  if (!user.roles.some((role) => role.role === 'HOD' && role.departmentId === departmentId)) {
    throw new AppError(403, 'DEPARTMENT_ACCESS_FORBIDDEN', 'You can only open the directory for a department you lead.');
  }
}

const departmentRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('/departments', async () => {
    const rows = await db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(departments)
      .where(ne(departments.code, UNASSIGNED_DEPARTMENT_CODE))
      .orderBy(asc(departments.name));
    return { departments: rows };
  });

  app.get('/departments/:id/faculty', { preHandler: app.requireBooking }, async (request) => {
    const { id } = parseInput(z.object({ id: z.string().uuid() }), request.params);
    const faculty = await listFacultyCandidates(db, id);
    return { faculty: faculty.map((person) => ({ id: person.userId, ...person })) };
  });

  app.get('/departments/:id/members', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(departmentParams, request.params);
    requireDepartmentHead(request.auth!.user, id);
    const filters = parseInput(directoryQuery, request.query);
    const { users, total } = await listUserViews(db, { ...filters, departmentId: id });
    return {
      total,
      members: users.map(({ id: userId, firstName, lastName, email, status, roles }) => ({
        id: userId, firstName, lastName, email, status, roles: [...new Set(roles.map(({ role }) => role))],
      })),
    };
  });

  app.get('/departments/:id/venues', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(departmentParams, request.params);
    requireDepartmentHead(request.auth!.user, id);
    const filters = parseInput(directoryQuery, request.query);
    return listVenues(db, { ...filters, departmentId: id });
  });

  app.get('/admin/departments', {
    preHandler: app.requireRole('ADMINISTRATOR'),
    handler: async () => {
      const rows = await db
        .select({
          id: departments.id,
          code: departments.code,
          name: departments.name,
          createdAt: departments.createdAt,
          updatedAt: departments.updatedAt,
          usersCount: countDistinct(users.id),
          venuesCount: countDistinct(venues.id),
          eventsCount: countDistinct(events.id),
        })
        .from(departments)
        .leftJoin(users, eq(users.departmentId, departments.id))
        .leftJoin(venues, eq(venues.departmentId, departments.id))
        .leftJoin(events, eq(events.departmentId, departments.id))
        .where(ne(departments.code, UNASSIGNED_DEPARTMENT_CODE))
        .groupBy(departments.id)
        .orderBy(asc(departments.name));

      return {
        departments: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          usersCount: Number(r.usersCount),
          venuesCount: Number(r.venuesCount),
          eventsCount: Number(r.eventsCount),
        })),
      };
    },
  });

  app.post<{ Body: DepartmentInput }>('/admin/departments', {
    preHandler: app.requireRole('ADMINISTRATOR'),
    handler: async (request, reply) => {
      const input = parseInput(departmentInputSchema, request.body);
      const code = input.code.trim().toUpperCase();
      if (code === UNASSIGNED_DEPARTMENT_CODE) throw new AppError(400, 'DEPARTMENT_RESERVED', 'This department code is reserved.');

      const [existing] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(sql`upper(${departments.code}) = ${code}`)
        .limit(1);

      if (existing) {
        throw new AppError(409, 'DEPARTMENT_CODE_EXISTS', 'A department with this code already exists.');
      }

      const [created] = await db
        .insert(departments)
        .values({
          code,
          name: input.name.trim(),
        })
        .returning();

      if (!created) {
        throw new Error('Department creation returned no row.');
      }

      await writeAudit(db, {
        actorId: request.auth!.user.id,
        action: 'DEPARTMENT_CREATED',
        entityName: 'departments',
        entityId: created.id,
        newState: { code: created.code, name: created.name },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(201);
      return {
        department: {
          id: created.id,
          code: created.code,
          name: created.name,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
          usersCount: 0,
          venuesCount: 0,
          eventsCount: 0,
        },
      };
    },
  });

  app.patch<{ Params: { id: string }; Body: DepartmentUpdateInput }>(
    '/admin/departments/:id',
    {
      preHandler: app.requireRole('ADMINISTRATOR'),
      handler: async (request) => {
        const { id } = request.params;
        const input = parseInput(departmentUpdateSchema, request.body);

        const [existing] = await db
          .select()
          .from(departments)
          .where(eq(departments.id, id))
          .limit(1);

        if (!existing) {
          throw new AppError(404, 'DEPARTMENT_NOT_FOUND', 'Department not found.');
        }

        if (existing.code === UNASSIGNED_DEPARTMENT_CODE || input.code === UNASSIGNED_DEPARTMENT_CODE) {
          throw new AppError(400, 'DEPARTMENT_RESERVED', 'This department code is reserved.');
        }

        if (input.code) {
          const code = input.code.trim().toUpperCase();
          const [duplicate] = await db
            .select({ id: departments.id })
            .from(departments)
            .where(and(sql`upper(${departments.code}) = ${code}`, sql`${departments.id} != ${id}`))
            .limit(1);
          if (duplicate) {
            throw new AppError(409, 'DEPARTMENT_CODE_EXISTS', 'A department with this code already exists.');
          }
        }

        const [updated] = await db
          .update(departments)
          .set({
            ...(input.code ? { code: input.code.trim().toUpperCase() } : {}),
            ...(input.name ? { name: input.name.trim() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(departments.id, id))
          .returning();

        if (!updated) {
          throw new Error('Department update returned no row.');
        }

        await writeAudit(db, {
          actorId: request.auth!.user.id,
          action: 'DEPARTMENT_UPDATED',
          entityName: 'departments',
          entityId: id,
          oldState: { code: existing.code, name: existing.name },
          newState: { code: updated.code, name: updated.name },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });

        return {
          department: {
            id: updated.id,
            code: updated.code,
            name: updated.name,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          },
        };
      },
    },
  );

  app.delete<{ Params: { id: string } }>('/admin/departments/:id', {
    preHandler: app.requireRole('ADMINISTRATOR'),
    handler: async (request, reply) => {
      const { id } = request.params;

      const [existing] = await db
        .select()
        .from(departments)
        .where(eq(departments.id, id))
        .limit(1);

      if (!existing || existing.code === UNASSIGNED_DEPARTMENT_CODE) {
        throw new AppError(404, 'DEPARTMENT_NOT_FOUND', 'Department not found.');
      }

      const [userRef] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.departmentId, id))
        .limit(1);
      if (userRef) {
        throw new AppError(
          409,
          'DEPARTMENT_IN_USE',
          'Cannot delete department that has assigned users.',
        );
      }

      const [venueRef] = await db
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.departmentId, id))
        .limit(1);
      if (venueRef) {
        throw new AppError(
          409,
          'DEPARTMENT_IN_USE',
          'Cannot delete department that has assigned venues.',
        );
      }

      const [eventRef] = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.departmentId, id))
        .limit(1);
      if (eventRef) {
        throw new AppError(
          409,
          'DEPARTMENT_IN_USE',
          'Cannot delete department that has associated events.',
        );
      }

      await db.delete(departments).where(eq(departments.id, id));

      await writeAudit(db, {
        actorId: request.auth!.user.id,
        action: 'DEPARTMENT_DELETED',
        entityName: 'departments',
        entityId: id,
        oldState: { code: existing.code, name: existing.name },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.status(204);
      return null;
    },
  });
};

export default departmentRoutes;
