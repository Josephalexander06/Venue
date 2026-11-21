import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  APPROVER_ROLES,
  allotmentCancelSchema,
  allotmentConfirmSchema,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import { cancelAllotment, confirmAllotment, getCompetingRequests } from './service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const requestIdParamsSchema = z.object({ requestId: z.string().uuid() });

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

export const allotmentRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const approverOnly = { preHandler: app.requireAnyRole(APPROVER_ROLES) };

  // POST /confirm: Commit final venue allotment
  app.post('/confirm', approverOnly, async (request) => {
    const input = parseInput(allotmentConfirmSchema, request.body);
    return confirmAllotment(db, viewerFrom(request), input, contextFrom(request));
  });

  // GET /competing/:requestId: Return side-by-side competitor comparison
  app.get('/competing/:requestId', approverOnly, async (request) => {
    const { requestId } = parseInput(requestIdParamsSchema, request.params);
    return getCompetingRequests(db, requestId, viewerFrom(request));
  });

  // POST /:id/cancel: Cancel confirmed allotment
  app.post('/:id/cancel', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(allotmentCancelSchema, request.body);
    return cancelAllotment(db, id, viewerFrom(request), input.reason, contextFrom(request));
  });

  // DELETE /:id: Cancel confirmed allotment (RESTful alias)
  app.delete('/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const bodyReason = (request.body as { reason?: string } | undefined)?.reason;
    const queryReason = (request.query as { reason?: string } | undefined)?.reason;
    const reason = bodyReason || queryReason || 'Cancelled by authorized user.';
    return cancelAllotment(db, id, viewerFrom(request), reason, contextFrom(request));
  });
};

export default allotmentRoutes;
