import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  APPROVER_ROLES,
  approvalDecisionInputSchema,
  approvalInboxQuerySchema,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import { decideRequest, getApprovalDetail, listApprovalInbox } from './service.js';

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

const approvalRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const approverOnly = { preHandler: app.requireAnyRole(APPROVER_ROLES) };

  app.get('/inbox', approverOnly, async (request) => {
    const page = parseInput(approvalInboxQuerySchema, request.query);
    return listApprovalInbox(db, viewerFrom(request), page);
  });

  app.get('/:id', { preHandler: app.authenticate }, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    return getApprovalDetail(db, id, viewerFrom(request));
  });

  app.post('/:id/decision', approverOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(approvalDecisionInputSchema, request.body);
    return decideRequest(db, id, viewerFrom(request), input, contextFrom(request));
  });
};

export default approvalRoutes;
