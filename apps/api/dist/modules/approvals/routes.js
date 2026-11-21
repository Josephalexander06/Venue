import { z } from 'zod';
import { APPROVER_ROLES, approvalDecisionInputSchema, approvalInboxQuerySchema, } from '@venue/shared';
import { parseInput } from '../../lib/validation.js';
import { decideRequest, getApprovalDetail, listApprovalInbox } from './service.js';
const idParamsSchema = z.object({ id: z.string().uuid() });
function viewerFrom(request) {
    return {
        userId: request.auth.user.id,
        isAdmin: request.auth.user.roles.some((entry) => entry.role === 'ADMINISTRATOR'),
    };
}
function contextFrom(request) {
    const userAgent = request.headers['user-agent'];
    return {
        ipAddress: request.ip,
        userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    };
}
const approvalRoutes = async (app, { db }) => {
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
//# sourceMappingURL=routes.js.map