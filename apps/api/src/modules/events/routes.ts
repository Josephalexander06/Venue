import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  eventCoordinatorSchema,
  eventInputSchema,
  eventOrganizerSchema,
  eventUpdateSchema,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import {
  addEventOrganizer,
  cancelEvent,
  createEvent,
  getEventTeam,
  getEventView,
  listFacultyCandidates,
  listMyEvents,
  listOrganizerCandidates,
  removeEventOrganizer,
  setEventCoordinator,
  updateEvent,
} from './service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const organizerParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});
const candidateQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});

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
  const memberOnly = { preHandler: app.authenticate };

  app.get('/events/mine', memberOnly, async (request) => {
    return { events: await listMyEvents(db, request.auth!.user.id) };
  });

  app.get('/events/faculty-candidates', { preHandler: app.requireBooking }, async (request) => {
    const { departmentId } = parseInput(z.object({ departmentId: z.string().uuid().optional() }), request.query);
    const faculty = await listFacultyCandidates(db, departmentId);
    return { candidates: faculty.map(({ department, ...person }) => ({ ...person, departmentName: department.name })) };
  });

  app.get('/events/:id', memberOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return { event: await getEventView(db, id, viewerFrom(request)) };
  });

  app.post('/events', { preHandler: app.requireBooking }, async (request, reply) => {
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

  app.patch('/events/:id', memberOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(eventUpdateSchema, request.body);
    return {
      event: await updateEvent(db, id, viewerFrom(request), input, contextFrom(request)),
    };
  });

  app.delete('/events/:id', memberOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return {
      event: await cancelEvent(db, id, viewerFrom(request), contextFrom(request)),
    };
  });

  app.get('/events/:id/team', memberOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return {
      team: await getEventTeam(db, id, viewerFrom(request)),
    };
  });

  app.get('/events/:id/organizer-candidates', memberOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const { search } = parseInput(candidateQuerySchema, request.query);
    return {
      candidates: await listOrganizerCandidates(db, id, viewerFrom(request), search),
    };
  });

  app.post('/events/:id/coordinator', memberOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(eventCoordinatorSchema, request.body);
    return {
      team: await setEventCoordinator(db, id, viewerFrom(request), input, contextFrom(request)),
    };
  });

  app.post('/events/:id/organizers', memberOnly, async (request, reply) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(eventOrganizerSchema, request.body);
    const team = await addEventOrganizer(db, id, viewerFrom(request), input, contextFrom(request));
    return reply.status(201).send({ team });
  });

  app.delete('/events/:id/organizers/:userId', memberOnly, async (request) => {
    const { id, userId } = parseInput(organizerParamsSchema, request.params);
    return {
      team: await removeEventOrganizer(db, id, viewerFrom(request), userId, contextFrom(request)),
    };
  });
};

export default eventRoutes;
