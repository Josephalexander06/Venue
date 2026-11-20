import { eq } from 'drizzle-orm';
import type { RoleName, WorkflowScopeType } from '@venue/shared';
import type { DbExecutor } from '../../db/index.js';
import { roles, userRoles } from '../../db/schema.js';

export interface ViewerRole {
  role: RoleName;
  departmentId: string | null;
}

interface ScopedStep {
  requiredRole: RoleName;
  scopeType: WorkflowScopeType;
}

export async function loadViewerRoles(db: DbExecutor, userId: string): Promise<ViewerRole[]> {
  return db
    .select({ role: roles.name, departmentId: userRoles.departmentId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
}

export function eligibleForStep(
  viewerRoles: ViewerRole[],
  step: ScopedStep,
  creatorDepartmentId: string,
  venueDepartmentId: string | null,
) {
  if (step.scopeType === 'VENUE_DEPARTMENT' && !venueDepartmentId) return false;
  const expectedDepartment =
    step.scopeType === 'CREATOR_DEPARTMENT'
      ? creatorDepartmentId
      : step.scopeType === 'VENUE_DEPARTMENT'
        ? venueDepartmentId
        : null;
  return viewerRoles.some(
    (entry) =>
      (entry.role === step.requiredRole || entry.role === 'ADMINISTRATOR') &&
      (step.scopeType === 'COLLEGE_WIDE'
        ? true
        : entry.role === 'ADMINISTRATOR' || entry.departmentId === expectedDepartment),
  );
}

export function isWorkflowParticipant(
  viewerRoles: ViewerRole[],
  steps: ScopedStep[],
  creatorDepartmentId: string,
  venueDepartmentId: string | null,
) {
  return steps.some((step) =>
    eligibleForStep(viewerRoles, step, creatorDepartmentId, venueDepartmentId),
  );
}
