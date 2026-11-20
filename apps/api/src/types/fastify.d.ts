import type { AuthenticatedSession } from '../modules/auth/service.js';
import type { UserView } from '../modules/users/view.js';
import type { RoleName } from '@venue/shared';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthenticatedSession;
    csrfToken?: string;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: RoleName) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAnyRole: (
      roles: readonly RoleName[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export type { UserView };
