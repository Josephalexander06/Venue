import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  APPROVER_ROLES,
  allotmentConfirmSchema,
  approvalDecisionInputSchema,
  approvalInboxQuerySchema,
} from '@venue/shared';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import { approveAndAllot, decideRequest, getApprovalDetail, listApprovalInbox } from './service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const approveAndAllotSchema = allotmentConfirmSchema
  .pick({ remarks: true, expectedUpdatedAt: true, reviewedCompetingRequestIds: true })
  .required({ expectedUpdatedAt: true, reviewedCompetingRequestIds: true });

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
    return listApprovalInbox(db, { ...viewerFrom(request), roles: request.auth!.user.roles }, page);
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

  app.post('/:id/approve-and-allot', approverOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(approveAndAllotSchema, request.body);
    return approveAndAllot(db, id, viewerFrom(request), input, contextFrom(request));
  });
};

export default approvalRoutes;
