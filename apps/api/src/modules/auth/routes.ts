import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, registrationSchema } from '@venue/shared';
import type { AppEnv } from '../../env.js';
import type { Database } from '../../db/index.js';
import { parseInput } from '../../lib/validation.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../lib/tokens.js';
import { z } from 'zod';
import {
  authenticateCredentials,
  authenticateOrRegisterGoogle,
  createSession,
  registerUser,
  revokeSession,
} from './service.js';

interface AuthRoutesOptions {
  db: Database;
  env: AppEnv;
}

const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { db, env }) => {
  const cookieBase = {
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: '/',
  } as const;

  app.post(
    '/register',
    { config: { rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = parseInput(registrationSchema, request.body);
      const created = await registerUser(db, input, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({
        user: {
          id: created.id,
          email: created.email,
          status: created.status,
          createdAt: created.createdAt.toISOString(),
        },
        message: 'Registration received. An administrator must approve your account before you can sign in.',
      });
    },
  );

  app.post(
    '/login',
    { config: { rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = parseInput(loginSchema, request.body);
      const user = await authenticateCredentials(db, input.email, input.password);
      const session = await createSession(db, user.id, env.SESSION_TTL_HOURS, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      reply.setCookie(SESSION_COOKIE, session.token, {
        ...cookieBase,
        httpOnly: true,
        expires: session.expiresAt,
      });

      return {
        user,
        csrfToken: request.csrfToken ?? request.cookies[CSRF_COOKIE] ?? '',
      };
    },
  );

  app.post(
    '/google',
    { config: { rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const googleSchema = z.object({
        email: z.string().email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      });
      const input = parseInput(googleSchema, request.body);
      const result = await authenticateOrRegisterGoogle(db, input, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (result.status === 'ACTIVE' && result.user) {
        const session = await createSession(db, result.user.id, env.SESSION_TTL_HOURS, {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });

        reply.setCookie(SESSION_COOKIE, session.token, {
          ...cookieBase,
          httpOnly: true,
          expires: session.expiresAt,
        });

        return {
          user: result.user,
          csrfToken: request.csrfToken ?? request.cookies[CSRF_COOKIE] ?? '',
        };
      }

      return reply.code(200).send({
        status: result.status,
        message: result.message,
        isNew: result.isNew,
        email: input.email,
      });
    },
  );

  app.post('/logout', { preHandler: app.authenticate }, async (request, reply) => {
    if (request.auth) await revokeSession(db, request.auth.tokenHash);
    reply.clearCookie(SESSION_COOKIE, cookieBase);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    return {
      user: request.auth!.user,
      csrfToken: request.csrfToken ?? request.cookies[CSRF_COOKIE] ?? '',
    };
  });
};

export default authRoutes;
