import type { FastifyPluginAsync } from 'fastify';
import { and, asc, countDistinct, eq, inArray, sql } from 'drizzle-orm';
import {
  departmentInputSchema,
  departmentUpdateSchema,
  type DepartmentInput,
  type DepartmentUpdateInput,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import {
  departments,
  events,
  roles,
  userRoles,
  users,
  venues,
} from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { parseInput } from '../../lib/validation.js';

const departmentRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('/departments', async () => {
    const rows = await db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(departments)
      .orderBy(asc(departments.name));
    return { departments: rows };
  });

  app.get<{ Params: { id: string } }>('/departments/:id/faculty', {
    preHandler: app.authenticate,
    handler: async (request) => {
      const { id } = request.params;
      const rows = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          departmentId: departments.id,
          departmentCode: departments.code,
          departmentName: departments.name,
        })
        .from(users)
        .innerJoin(departments, eq(departments.id, users.departmentId))
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(users.status, 'ACTIVE'),
            eq(users.departmentId, id),
            inArray(roles.name, ['FACULTY', 'HOD']),
          ),
        )
        .groupBy(users.id, departments.id)
        .orderBy(asc(users.lastName), asc(users.firstName));

      return {
        faculty: rows.map((r) => ({
          id: r.id,
          userId: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          department: {
            id: r.departmentId,
            code: r.departmentCode,
            name: r.departmentName,
          },
        })),
      };
    },
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

      if (!existing) {
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
