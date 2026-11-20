import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BOOKING_ROLES, eventInputSchema, eventUpdateSchema } from '@venue/shared';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import { cancelEvent, createEvent, getEventView, listMyEvents, updateEvent } from './service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

function viewerFrom(request: { auth?: { user: { id: string; roles: { role: string }[] } } }) {
  return {
    userId: request.auth!.user.id,
    isAdmin: request.auth!.user.roles.some((entry) => entry.role === 'ADMINISTRATOR'),
  };
}

function contextFrom(request: {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}) {
  const userAgent = request.headers['user-agent'];
  return {
    ipAddress: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
  };
}

const eventRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const bookingOnly = { preHandler: app.requireAnyRole(BOOKING_ROLES) };

  app.get('/events/mine', bookingOnly, async (request) => {
    return { events: await listMyEvents(db, request.auth!.user.id) };
  });

  app.get('/events/:id', bookingOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return { event: await getEventView(db, id, viewerFrom(request)) };
  });

  app.post('/events', bookingOnly, async (request, reply) => {
    const input = parseInput(eventInputSchema, request.body);
    const event = await createEvent(
      db,
      {
        ...viewerFrom(request),
        departmentId: request.auth!.user.department.id,
      },
      input,
      contextFrom(request),
    );
    return reply.status(201).send({ event });
  });

  app.patch('/events/:id', bookingOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(eventUpdateSchema, request.body);
    return {
      event: await updateEvent(db, id, viewerFrom(request), input, contextFrom(request)),
    };
  });

  app.delete('/events/:id', bookingOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return {
      event: await cancelEvent(db, id, viewerFrom(request), contextFrom(request)),
    };
  });
};

export default eventRoutes;
