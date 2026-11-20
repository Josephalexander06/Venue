import { asc, count, desc, eq, isNotNull } from 'drizzle-orm';
import type {
  WorkflowInput,
  WorkflowStepInput,
  WorkflowUpdateInput,
} from '@venue/shared';
import type { Database, DbExecutor } from '../../db/index.js';
import {
  approvalInstances,
  approvalWorkflows,
  venues,
  workflowSteps,
} from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

interface Actor {
  actorId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface WorkflowStepView {
  id: string;
  stepOrder: number;
  stepName: string;
  requiredRole: (typeof workflowSteps.$inferSelect)['requiredRole'];
  scopeType: (typeof workflowSteps.$inferSelect)['scopeType'];
  isFinalAllotmentStep: boolean;
}

export interface WorkflowView {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  steps: WorkflowStepView[];
  venueCount: number;
  usageCount: number;
  stepsLocked: boolean;
  createdAt: string;
}

function mapStep(row: typeof workflowSteps.$inferSelect): WorkflowStepView {
  return {
    id: row.id,
    stepOrder: row.stepOrder,
    stepName: row.stepName,
    requiredRole: row.requiredRole,
    scopeType: row.scopeType,
    isFinalAllotmentStep: row.isFinalAllotmentStep,
  };
}

export async function listWorkflows(db: Database) {
  const rows = await db
    .select()
    .from(approvalWorkflows)
    .orderBy(desc(approvalWorkflows.isDefault), asc(approvalWorkflows.name));
  const steps = await db
    .select()
    .from(workflowSteps)
    .orderBy(asc(workflowSteps.workflowId), asc(workflowSteps.stepOrder));
  const venueCounts = await db
    .select({ workflowId: venues.workflowId, value: count() })
    .from(venues)
    .where(isNotNull(venues.workflowId))
    .groupBy(venues.workflowId);
  const usageCounts = await db
    .select({ workflowId: approvalInstances.workflowId, value: count() })
    .from(approvalInstances)
    .groupBy(approvalInstances.workflowId);

  const venueCountMap = new Map(venueCounts.map((row) => [row.workflowId, row.value]));
  const usageCountMap = new Map(usageCounts.map((row) => [row.workflowId, row.value]));
  return {
    workflows: rows.map((row) => {
      const usageCount = usageCountMap.get(row.id) ?? 0;
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        isDefault: row.isDefault,
        steps: steps.filter((step) => step.workflowId === row.id).map(mapStep),
        venueCount: venueCountMap.get(row.id) ?? 0,
        usageCount,
        stepsLocked: usageCount > 0,
        createdAt: row.createdAt.toISOString(),
      } satisfies WorkflowView;
    }),
  };
}

export async function getWorkflowView(db: Database, workflowId: string) {
  const view = (await listWorkflows(db)).workflows.find((workflow) => workflow.id === workflowId);
  if (!view) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Approval workflow not found.');
  return view;
}

export async function requireWorkflow(db: DbExecutor, workflowId: string) {
  const [workflow] = await db
    .select({ id: approvalWorkflows.id })
    .from(approvalWorkflows)
    .where(eq(approvalWorkflows.id, workflowId))
    .limit(1);
  if (!workflow) throw new AppError(400, 'WORKFLOW_NOT_FOUND', 'Approval workflow not found.');
  return workflow.id;
}

export async function getDefaultWorkflowId(db: DbExecutor) {
  const [workflow] = await db
    .select({ id: approvalWorkflows.id })
    .from(approvalWorkflows)
    .where(eq(approvalWorkflows.isDefault, true))
    .limit(1);
  if (!workflow) {
    throw new AppError(500, 'WORKFLOW_NOT_CONFIGURED', 'No default approval workflow is configured.');
  }
  return workflow.id;
}

export async function resolveWorkflowId(db: DbExecutor, workflowId?: string | null) {
  if (workflowId) return requireWorkflow(db, workflowId);
  return getDefaultWorkflowId(db);
}

export async function loadWorkflowSteps(db: DbExecutor, workflowId: string) {
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowId, workflowId))
    .orderBy(asc(workflowSteps.stepOrder));
  if (steps.length === 0) {
    throw new AppError(500, 'WORKFLOW_NOT_CONFIGURED', 'This approval workflow has no steps.');
  }
  return steps;
}

function stepValues(workflowId: string, steps: WorkflowStepInput[]) {
  return steps.map((step, index) => ({
    workflowId,
    stepOrder: index + 1,
    stepName: step.stepName,
    requiredRole: step.requiredRole,
    scopeType: step.scopeType,
    isFinalAllotmentStep: step.isFinalAllotmentStep,
  }));
}

export async function createWorkflow(db: Database, input: WorkflowInput, actor: Actor) {
  const workflowId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: approvalWorkflows.id })
      .from(approvalWorkflows)
      .limit(1);
    const makeDefault = input.isDefault || !existing;
    if (makeDefault) {
      await tx.update(approvalWorkflows).set({ isDefault: false });
    }
    const [created] = await tx
      .insert(approvalWorkflows)
      .values({
        name: input.name,
        description: input.description || null,
        isDefault: makeDefault,
      })
      .returning({ id: approvalWorkflows.id });
    if (!created) throw new Error('Workflow insert returned no row.');
    await tx.insert(workflowSteps).values(stepValues(created.id, input.steps));
    await writeAudit(tx, {
      actorId: actor.actorId,
      action: 'WORKFLOW_CREATED',
      entityName: 'approval_workflows',
      entityId: created.id,
      newState: {
        name: input.name,
        isDefault: makeDefault,
        steps: input.steps,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return created.id;
  });

  return getWorkflowView(db, workflowId);
}

export async function updateWorkflow(
  db: Database,
  workflowId: string,
  input: WorkflowUpdateInput,
  actor: Actor,
) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(approvalWorkflows)
      .where(eq(approvalWorkflows.id, workflowId))
      .for('update')
      .limit(1);
    if (!existing) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Approval workflow not found.');

    if (input.steps) {
      const [usage] = await tx
        .select({ value: count() })
        .from(approvalInstances)
        .where(eq(approvalInstances.workflowId, workflowId));
      if ((usage?.value ?? 0) > 0) {
        throw new AppError(
          409,
          'WORKFLOW_IN_USE',
          'This workflow has handled requests. Create a new workflow instead of changing its steps.',
        );
      }
      await tx.delete(workflowSteps).where(eq(workflowSteps.workflowId, workflowId));
      await tx.insert(workflowSteps).values(stepValues(workflowId, input.steps));
    }

    if (input.isDefault === true) {
      await tx.update(approvalWorkflows).set({ isDefault: false });
    }
    if (input.isDefault === false && existing.isDefault) {
      throw new AppError(
        409,
        'DEFAULT_WORKFLOW_REQUIRED',
        'Set another workflow as the default before clearing this one.',
      );
    }

    await tx
      .update(approvalWorkflows)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description || null }
          : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      })
      .where(eq(approvalWorkflows.id, workflowId));

    await writeAudit(tx, {
      actorId: actor.actorId,
      action: 'WORKFLOW_UPDATED',
      entityName: 'approval_workflows',
      entityId: workflowId,
      oldState: {
        name: existing.name,
        description: existing.description,
        isDefault: existing.isDefault,
      },
      newState: {
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        isDefault: input.isDefault ?? existing.isDefault,
        ...(input.steps ? { steps: input.steps } : {}),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  });

  return getWorkflowView(db, workflowId);
}
