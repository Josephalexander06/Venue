import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE } from '../lib/tokens.js';
import { resolveSession, revokeSession } from '../modules/auth/service.js';
const authPlugin = async (app, { db }) => {
    app.decorateRequest('auth');
    const authenticate = async (request) => {
        const token = request.cookies[SESSION_COOKIE];
        if (!token) {
            throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
        }
        const session = await resolveSession(db, token);
        if (!session) {
            throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
        }
        if (session.user.status !== 'ACTIVE') {
            await revokeSession(db, session.tokenHash);
            throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active.');
        }
        request.auth = session;
    };
    const requireAnyRole = (allowed) => {
        return async (request) => {
            await authenticate(request);
            const roles = request.auth?.user.roles.map((entry) => entry.role) ?? [];
            const isAdmin = roles.includes('ADMINISTRATOR');
            if (!isAdmin && !roles.some((role) => allowed.includes(role))) {
                throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do that.');
            }
        };
    };
    const requireRole = (role) => requireAnyRole([role]);
    app.decorate('authenticate', authenticate);
    app.decorate('requireRole', requireRole);
    app.decorate('requireAnyRole', requireAnyRole);
};
export default fp(authPlugin, { name: 'auth', dependencies: ['@fastify/cookie'] });
//# sourceMappingURL=auth.js.map