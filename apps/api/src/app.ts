import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@venue/shared';
import type { AppEnv } from './env.js';
import type { Database } from './db/index.js';
import csrfPlugin from './plugins/csrf.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './modules/auth/routes.js';
import adminRoutes from './modules/admin/routes.js';
import approvalRoutes from './modules/approvals/routes.js';
import departmentRoutes from './modules/departments/routes.js';
import eventRoutes from './modules/events/routes.js';
import requestRoutes from './modules/requests/routes.js';
import venueRoutes from './modules/venues/routes.js';
import workflowRoutes from './modules/workflows/routes.js';
import { AppError, fieldErrorsFromZod } from './lib/errors.js';
import { findPostgresError } from './lib/postgres-error.js';

interface BuildAppOptions {
  db: Database;
  env: AppEnv;
  logger?: boolean;
}

export async function buildApp({ db, env, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  const corsOrigins = [
    env.FRONTEND_URL,
    ...(env.NODE_ENV === 'development'
      ? [
          env.FRONTEND_URL.includes('localhost')
            ? env.FRONTEND_URL.replace('localhost', '127.0.0.1')
            : env.FRONTEND_URL.replace('127.0.0.1', 'localhost'),
        ]
      : []),
  ];

  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: env.NODE_ENV !== 'test',
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: (request) => request.url === '/health',
  });
  await app.register(csrfPlugin, { env });
  await app.register(authPlugin, { db });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toBody());
    }

    if (error instanceof ZodError) {
      const body: ApiErrorBody = {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Please correct the highlighted fields.',
        fieldErrors: fieldErrorsFromZod(error.issues),
      };
      return reply.status(400).send(body);
    }

    const pgError = findPostgresError(error);
    if (pgError?.code === '23505') {
      const isEmail = pgError.constraint?.includes('email');
      return reply.status(409).send({
        statusCode: 409,
        code: isEmail ? 'EMAIL_IN_USE' : 'CONFLICT',
        message: isEmail
          ? 'An account with that email already exists.'
          : 'That record conflicts with an existing one.',
      } satisfies ApiErrorBody);
    }
    if (pgError?.code === '23P01') {
      return reply.status(409).send({
        statusCode: 409,
        code: 'SLOT_ALREADY_ALLOTTED',
        message: 'The venue was allotted to another event during this review.',
      } satisfies ApiErrorBody);
    }

    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (statusCode === 500) {
      request.log.error({ err: error }, 'Unhandled request error');
    }
    return reply.status(statusCode).send({
      statusCode,
      code: statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      message: statusCode === 500 ? 'Something went wrong. Please try again.' : error.message,
    } satisfies ApiErrorBody);
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    } satisfies ApiErrorBody);
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(departmentRoutes, { db, prefix: '/api/v1' });
  await app.register(authRoutes, { db, env, prefix: '/api/v1/auth' });
  await app.register(adminRoutes, { db, prefix: '/api/v1/admin' });
  await app.register(venueRoutes, { db, prefix: '/api/v1' });
  await app.register(eventRoutes, { db, prefix: '/api/v1' });
  await app.register(requestRoutes, { db, prefix: '/api/v1' });
  await app.register(approvalRoutes, { db, prefix: '/api/v1/approvals' });
  await app.register(workflowRoutes, { db, prefix: '/api/v1' });

  return app;
}
