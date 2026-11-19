import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { newOpaqueToken, safeEqual } from '../lib/tokens.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../lib/tokens.js';
import type { AppEnv } from '../env.js';

const CSRF_EXEMPT = new Set(['/api/v1/auth/login', '/api/v1/auth/register']);

const csrfPlugin: FastifyPluginAsync<{ env: AppEnv }> = async (app, { env }) => {
  app.addHook('onRequest', async (request, reply) => {
    let token = request.cookies[CSRF_COOKIE];
    if (!token) {
      token = newOpaqueToken();
      reply.setCookie(CSRF_COOKIE, token, {
        httpOnly: false,
        secure: env.COOKIE_SECURE,
        sameSite: env.COOKIE_SAME_SITE,
        path: '/',
        maxAge: env.SESSION_TTL_HOURS * 60 * 60,
      });
    }
    request.csrfToken = token;

    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;

    const origin = request.headers.origin;
    if (origin && origin !== env.FRONTEND_URL) {
      throw new AppError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
    }

    const pathname = request.url.split('?')[0] ?? '';
    if (CSRF_EXEMPT.has(pathname)) return;
    // Without an authenticated cookie there is no session to forge.
    if (!request.cookies[SESSION_COOKIE]) return;

    const header = request.headers[CSRF_HEADER];
    if (
      !token ||
      typeof header !== 'string' ||
      !safeEqual(token, header)
    ) {
      throw new AppError(403, 'CSRF_TOKEN_INVALID', 'Security token expired. Refresh and try again.');
    }
  });
};

export default fp(csrfPlugin, { name: 'csrf', dependencies: ['@fastify/cookie'] });
