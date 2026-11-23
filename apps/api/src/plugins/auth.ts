import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { canBookVenues, type RoleName } from '@venue/shared';
import type { Database } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE } from '../lib/tokens.js';
import { PENDING_SESSION_PREFIX, resolveSession, revokeSession } from '../modules/auth/service.js';

const authPlugin: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.decorateRequest('auth');

  const readSession = async (request: FastifyRequest, allowPending: boolean) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    }

    const session = await resolveSession(db, token);
    if (!session) {
      throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    }
    const pendingSession = session.user.status === 'PENDING_APPROVAL' && token.startsWith(PENDING_SESSION_PREFIX);
    if (session.user.status !== 'ACTIVE' && !(allowPending && pendingSession)) {
      if (!pendingSession) await revokeSession(db, session.tokenHash);
      throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active.');
    }

    request.auth = session;
  };

  const authenticate = (request: FastifyRequest) => readSession(request, false);
  const authenticateCatalog = (request: FastifyRequest) => readSession(request, true);

  const requireAnyRole = (allowed: readonly RoleName[]) => {
    return async (request: FastifyRequest) => {
      await authenticate(request);
      const roles = request.auth?.user.roles.map((entry) => entry.role) ?? [];
      const isAdmin = roles.includes('ADMINISTRATOR');
      if (!isAdmin && !roles.some((role) => allowed.includes(role))) {
        throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do that.');
      }
    };
  };

  const requireBooking = async (request: FastifyRequest) => {
    await authenticate(request);
    if (!canBookVenues(request.auth!.user.roles.map(({ role }) => role))) {
      throw new AppError(403, 'BOOKING_FORBIDDEN', 'This account does not have permission to book venues.');
    }
  };

  const requireRole = (role: RoleName) => requireAnyRole([role]);

  app.decorate('authenticate', authenticate);
  app.decorate('authenticateCatalog', authenticateCatalog);
  app.decorate('requireBooking', requireBooking);
  app.decorate('requireRole', requireRole);
  app.decorate('requireAnyRole', requireAnyRole);
};

export default fp(authPlugin, { name: 'auth', dependencies: ['@fastify/cookie'] });
