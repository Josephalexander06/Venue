import { eq } from 'drizzle-orm';
import { roles, userRoles } from '../../db/schema.js';
export async function loadViewerRoles(db, userId) {
    return db
        .select({ role: roles.name, departmentId: userRoles.departmentId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, userId));
}
export function eligibleForStep(viewerRoles, step, creatorDepartmentId, venueDepartmentId) {
    if (step.scopeType === 'VENUE_DEPARTMENT' && !venueDepartmentId)
        return false;
    const expectedDepartment = step.scopeType === 'CREATOR_DEPARTMENT'
        ? creatorDepartmentId
        : step.scopeType === 'VENUE_DEPARTMENT'
            ? venueDepartmentId
            : null;
    return viewerRoles.some((entry) => (entry.role === step.requiredRole || entry.role === 'ADMINISTRATOR') &&
        (step.scopeType === 'COLLEGE_WIDE'
            ? true
            : entry.role === 'ADMINISTRATOR' || entry.departmentId === expectedDepartment));
}
export function isWorkflowParticipant(viewerRoles, steps, creatorDepartmentId, venueDepartmentId) {
    return steps.some((step) => eligibleForStep(viewerRoles, step, creatorDepartmentId, venueDepartmentId));
}
//# sourceMappingURL=eligibility.js.map