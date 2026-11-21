import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { newOpaqueToken, safeEqual } from '../lib/tokens.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../lib/tokens.js';
const CSRF_EXEMPT = new Set([
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/logout',
]);
const csrfPlugin = async (app, { env }) => {
    const allowedOrigins = new Set([
        env.FRONTEND_URL,
        ...(env.NODE_ENV === 'development'
            ? [
                env.FRONTEND_URL.includes('localhost')
                    ? env.FRONTEND_URL.replace('localhost', '127.0.0.1')
                    : env.FRONTEND_URL.replace('127.0.0.1', 'localhost'),
            ]
            : []),
    ]);
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
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
            return;
        const origin = request.headers.origin;
        if (origin && !allowedOrigins.has(origin)) {
            throw new AppError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
        }
        const pathname = request.url.split('?')[0] ?? '';
        if (CSRF_EXEMPT.has(pathname))
            return;
        // Without an authenticated cookie there is no session to forge.
        if (!request.cookies[SESSION_COOKIE])
            return;
        const header = request.headers[CSRF_HEADER];
        if (!token ||
            typeof header !== 'string' ||
            !safeEqual(token, header)) {
            throw new AppError(403, 'CSRF_TOKEN_INVALID', 'Security token expired. Refresh and try again.');
        }
    });
};
export default fp(csrfPlugin, { name: 'csrf', dependencies: ['@fastify/cookie'] });
//# sourceMappingURL=csrf.js.map