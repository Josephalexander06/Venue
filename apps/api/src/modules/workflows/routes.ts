import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { workflowInputSchema, workflowUpdateSchema } from '@venue/shared';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import { createWorkflow, listWorkflows, updateWorkflow } from './service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

const workflowRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  const adminOnly = { preHandler: app.requireRole('ADMINISTRATOR' as const) };
  const authOnly = { preHandler: app.authenticate };

  app.get('/workflows', authOnly, async () => listWorkflows(db));
  app.get('/admin/workflows', adminOnly, async () => listWorkflows(db));

  app.post('/workflows', adminOnly, async (request, reply) => {
    const input = parseInput(workflowInputSchema, request.body);
    const workflow = await createWorkflow(db, input, {
      actorId: request.auth!.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return reply.status(201).send({ workflow });
  });
  app.post('/admin/workflows', adminOnly, async (request, reply) => {
    const input = parseInput(workflowInputSchema, request.body);
    const workflow = await createWorkflow(db, input, {
      actorId: request.auth!.user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return reply.status(201).send({ workflow });
  });

  app.patch('/workflows/:id', adminOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(workflowUpdateSchema, request.body);
    return {
      workflow: await updateWorkflow(db, id, input, {
        actorId: request.auth!.user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    };
  });
  app.patch('/admin/workflows/:id', adminOnly, async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(workflowUpdateSchema, request.body);
    return {
      workflow: await updateWorkflow(db, id, input, {
        actorId: request.auth!.user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    };
  });
};

export default workflowRoutes;
