import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import type { RoleName, WorkflowScopeType } from '@venue/shared';
import type { DbExecutor } from '../../db/index.js';
import { events, roles, userRoles, venues, workflowSteps } from '../../db/schema.js';

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

export function effectiveStepScope(step: ScopedStep, venueDepartmentId: string | null) {
  return step.requiredRole === 'HOD' && venueDepartmentId ? 'VENUE_DEPARTMENT' : step.scopeType;
}

export function eligibleForStep(
  viewerRoles: ViewerRole[],
  step: ScopedStep,
  creatorDepartmentId: string,
  venueDepartmentId: string | null,
  allowAdminOverride = true,
) {
  const scope = effectiveStepScope(step, venueDepartmentId);
  if (scope === 'VENUE_DEPARTMENT' && !venueDepartmentId) return false;
  const expectedDepartment =
    scope === 'CREATOR_DEPARTMENT'
      ? creatorDepartmentId
      : venueDepartmentId;
  return viewerRoles.some(
    (entry) =>
      (allowAdminOverride && entry.role === 'ADMINISTRATOR') ||
      (entry.role === step.requiredRole &&
        (scope === 'COLLEGE_WIDE' || entry.departmentId === expectedDepartment)),
  );
}

// SQL counterpart to eligibleForStep for paginating only the viewer's inbox rows.
export function eligibleInboxStep(viewerRoles: ViewerRole[]) {
  const scope = sql`CASE
    WHEN ${workflowSteps.requiredRole} = 'HOD' AND ${venues.departmentId} IS NOT NULL
    THEN 'VENUE_DEPARTMENT' ELSE ${workflowSteps.scopeType} END`;
  return and(
    or(sql`${scope} <> 'VENUE_DEPARTMENT'`, isNotNull(venues.departmentId)),
    or(sql`false`, ...viewerRoles.map(({ role, departmentId }) => (
      role === 'ADMINISTRATOR' ? sql`true` : and(
        eq(workflowSteps.requiredRole, role),
        or(
          sql`${scope} = 'COLLEGE_WIDE'`,
          departmentId ? and(sql`${scope} = 'CREATOR_DEPARTMENT'`, eq(events.departmentId, departmentId)) : undefined,
          departmentId ? and(sql`${scope} = 'VENUE_DEPARTMENT'`, eq(venues.departmentId, departmentId)) : undefined,
        ),
      )
    ))),
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
