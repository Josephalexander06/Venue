import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  BOOKING_ROLES,
  venueRequestInputSchema,
  venueRequestUpdateSchema,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import {
  cancelVenueRequest,
  createVenueRequest,
  getRequestView,
  updateVenueRequest,
} from './service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

function viewerFrom(request: { auth?: { user: { id: string; roles: { role: string }[]; department: { id: string } } } }) {
  return {
    userId: request.auth!.user.id,
    departmentId: request.auth!.user.department.id,
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

const requestRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const bookingOnly = { preHandler: app.requireAnyRole(BOOKING_ROLES) };

  app.get('/venue-requests/:id', bookingOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return getRequestView(db, id, viewerFrom(request));
  });

  app.post('/venue-requests', bookingOnly, async (request, reply) => {
    const input = parseInput(venueRequestInputSchema, request.body);
    const result = await createVenueRequest(db, viewerFrom(request), input, contextFrom(request));
    return reply.status(201).send(result);
  });

  app.patch('/venue-requests/:id', bookingOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(venueRequestUpdateSchema, request.body);
    return updateVenueRequest(db, id, viewerFrom(request), input, contextFrom(request));
  });

  app.delete('/venue-requests/:id', bookingOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return cancelVenueRequest(db, id, viewerFrom(request), contextFrom(request));
  });
};

export default requestRoutes;
