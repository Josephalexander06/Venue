import { and, asc, eq, exists, gt, inArray, isNotNull, ne, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  ApprovalDecisionInput,
  RoleName,
  WorkflowScopeType,
} from '@venue/shared';
import type { Database, DbExecutor } from '../../db/index.js';
import {
  approvalDecisions,
  approvalInstances,
  departments,
  eventOrganizers,
  events,
  users,
  venueAllotments,
  venueRequests,
  venues,
  workflowSteps,
} from '../../db/schema.js';
import { confirmAllotment } from '../allotments/service.js';
import { isEventCollaborator } from '../events/service.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { notifyRequestParticipants } from '../../lib/notifications.js';
import {
  getRequestView,
  type RequestDetailView,
} from '../requests/service.js';
import {
  mapRequestRow,
  requestSelection,
  type EventSummary,
  type RequestRow,
} from '../requests/view.js';
import {
  effectiveStepScope,
  eligibleForStep,
  eligibleInboxStep,
  loadViewerRoles,
  type ViewerRole,
} from './eligibility.js';

interface Viewer {
  userId: string;
  isAdmin: boolean;
}

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

const DECIDABLE_STATUSES = ['SUBMITTED', 'IN_REVIEW'] as const;
const INBOX_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT'] as const;

interface InboxRow extends RequestRow {
  creatorId: string;
  submittedByName: string;
  facultyCoordinatorId: string | null;
  title: string;
  description: string | null;
  expectedAttendance: number;
  eventStatus: EventSummary['status'];
  eventCreatedAt: Date;
  eventUpdatedAt: Date;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
}

export interface ApprovalInboxItem {
  request: ReturnType<typeof mapRequestRow>;
  event: EventSummary;
  step: {
    id: string;
    stepOrder: number;
    stepName: string;
    requiredRole: RoleName;
    scopeType: WorkflowScopeType;
    isFinalAllotmentStep: boolean;
  };
  conflicts: { confirmedCount: number; pendingCount: number };
  needsAction: boolean;
}

function eventSummary(row: InboxRow): EventSummary {
  return {
    id: row.eventId,
    title: row.title,
    description: row.description,
    expectedAttendance: row.expectedAttendance,
    status: row.eventStatus,
    department: {
      id: row.departmentId,
      code: row.departmentCode,
      name: row.departmentName,
    },
    facultyCoordinatorId: row.facultyCoordinatorId,
    creatorId: row.creatorId,
    submittedByName: row.submittedByName,
    createdAt: row.eventCreatedAt.toISOString(),
    updatedAt: row.eventUpdatedAt.toISOString(),
  };
}

export async function listApprovalInbox(
  db: Database,
  viewer: Viewer & { roles: ViewerRole[] },
  page: { limit: number; offset: number; view?: 'pending' | 'decided' | 'all' },
) {
  const pending = alias(venueRequests, 'pending');
  // The inbox only needs counts. Compare the indexed ranges without loading conflicting events.
  const confirmedCount = db.select({ count: sql<number>`count(*)::int` })
    .from(venueAllotments)
    .where(and(
      eq(venueAllotments.venueId, venueRequests.venueId),
      ne(venueAllotments.venueRequestId, venueRequests.id),
      eq(venueAllotments.status, 'ACTIVE'),
      sql`${venueAllotments.reservedRange} && ${venueRequests.effectiveRange}`,
    ));
  const pendingCount = db.select({ count: sql<number>`count(*)::int` })
    .from(pending)
    .where(and(
      eq(pending.venueId, venueRequests.venueId),
      ne(pending.id, venueRequests.id),
      inArray(pending.status, INBOX_STATUSES),
      sql`${pending.effectiveRange} && ${venueRequests.effectiveRange}`,
    ));
  const organizer = db.select({ id: eventOrganizers.id })
    .from(eventOrganizers)
    .where(and(eq(eventOrganizers.eventId, events.id), eq(eventOrganizers.userId, viewer.userId)));
  const awaitingAllotment = eq(venueRequests.status, 'APPROVED_PENDING_ALLOTMENT');

  const madeDecision = db.select({ id: approvalDecisions.id })
    .from(approvalDecisions)
    .innerJoin(approvalInstances, eq(approvalInstances.id, approvalDecisions.approvalInstanceId))
    .where(and(eq(approvalDecisions.approverId, viewer.userId), eq(approvalInstances.venueRequestId, venueRequests.id)));
  const actionable = and(
    inArray(venueRequests.status, INBOX_STATUSES),
    ne(events.creatorId, viewer.userId),
    ne(venueRequests.submittedById, viewer.userId),
    or(
      and(
        eq(venueRequests.currentStepOrder, 0),
        eq(venueRequests.requiresFacultyEndorsement, true),
        ne(venueRequests.status, 'APPROVED_PENDING_ALLOTMENT'),
        isNotNull(approvalInstances.id),
        viewer.isAdmin ? undefined : eq(events.facultyCoordinatorId, viewer.userId),
      ),
      and(
        gt(venueRequests.currentStepOrder, 0),
        isNotNull(workflowSteps.id),
        or(isNotNull(approvalInstances.id), awaitingAllotment),
        sql`${events.facultyCoordinatorId} IS DISTINCT FROM ${viewer.userId}`,
        notExists(organizer),
        or(viewer.isAdmin ? awaitingAllotment : undefined, eligibleInboxStep(viewer.roles)),
      ),
    ),
  );
  const hasDecided = exists(madeDecision);
  const query = db
    .select({
      ...requestSelection,
      needsAction: sql<boolean>`coalesce(${actionable}, false)`,
      submittedByName: sql<string>`concat_ws(' ', ${users.firstName}, ${users.lastName})`,
      creatorId: events.creatorId,
      facultyCoordinatorId: events.facultyCoordinatorId,
      title: events.title,
      description: events.description,
      expectedAttendance: events.expectedAttendance,
      eventStatus: events.status,
      eventCreatedAt: events.createdAt,
      eventUpdatedAt: events.updatedAt,
      departmentId: departments.id,
      departmentCode: departments.code,
      departmentName: departments.name,
      venueDepartmentId: venues.departmentId,
      step: {
        id: workflowSteps.id,
        stepName: workflowSteps.stepName,
        requiredRole: workflowSteps.requiredRole,
        scopeType: workflowSteps.scopeType,
        isFinalAllotmentStep: workflowSteps.isFinalAllotmentStep,
      },
      confirmedCount: sql<number>`(${confirmedCount})`,
      pendingCount: sql<number>`(${pendingCount})`,
      total: sql<number>`count(*) over ()::int`,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .innerJoin(users, eq(users.id, venueRequests.submittedById))
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .leftJoin(approvalInstances, and(
      eq(approvalInstances.venueRequestId, venueRequests.id),
      eq(approvalInstances.workflowId, venueRequests.workflowId),
      eq(approvalInstances.isActive, true),
      eq(approvalInstances.currentStepOrder, venueRequests.currentStepOrder),
    ))
    .leftJoin(workflowSteps, and(
      eq(workflowSteps.workflowId, venueRequests.workflowId),
      eq(workflowSteps.stepOrder, venueRequests.currentStepOrder),
    ))
    .where(page.view === 'decided' ? hasDecided : page.view === 'all' ? or(actionable, hasDecided) : actionable)
    .orderBy(asc(venueRequests.createdAt), asc(venueRequests.id));

  const rows = await query.limit(page.limit).offset(page.offset);
  // A page past the end has no window count. Read the count from the first row in that case.
  const total = rows[0]?.total ?? (page.offset ? (await query.limit(1).offset(0))[0]?.total : 0) ?? 0;
  const items = rows.map((row) => ({
    request: mapRequestRow(row),
    needsAction: row.needsAction,
    event: eventSummary(row),
    step: row.step ? {
      ...row.step,
      stepOrder: row.currentStepOrder,
      scopeType: effectiveStepScope(row.step, row.venueDepartmentId),
    } : {
      id: 'faculty-endorsement',
      stepOrder: 0,
      stepName: 'Faculty Coordinator Endorsement',
      requiredRole: 'FACULTY',
      scopeType: 'CREATOR_DEPARTMENT',
      isFinalAllotmentStep: false,
    },
    conflicts: { confirmedCount: row.confirmedCount, pendingCount: row.pendingCount },
  } satisfies ApprovalInboxItem));

  return { items, total, ...page };
}

export async function getApprovalDetail(
  db: Database,
  requestId: string,
  viewer: Viewer,
): Promise<RequestDetailView> {
  return getRequestView(db, requestId, viewer);
}

async function loadLockedRequest(db: DbExecutor, requestId: string) {
  const [request] = await db
    .select()
    .from(venueRequests)
    .where(eq(venueRequests.id, requestId))
    .for('update')
    .limit(1);
  if (!request) {
    throw new AppError(404, 'REQUEST_NOT_FOUND', 'Booking request not found.');
  }
  const [event] = await db
    .select({
      id: events.id,
      creatorId: events.creatorId,
      facultyCoordinatorId: events.facultyCoordinatorId,
      departmentId: events.departmentId,
      title: events.title,
      status: events.status,
    })
    .from(events)
    .where(eq(events.id, request.eventId))
    .limit(1);
  const [venue] = await db
    .select({
      id: venues.id,
      name: venues.name,
      departmentId: venues.departmentId,
    })
    .from(venues)
    .where(eq(venues.id, request.venueId))
    .limit(1);
  if (!event || !venue) {
    throw new AppError(409, 'REQUEST_DATA_INCOMPLETE', 'This request is missing venue or event data.');
  }
  return { request, event, venue };
}

export async function decideRequest(
  db: Database,
  requestId: string,
  viewer: Viewer,
  input: ApprovalDecisionInput,
  context: RequestContext,
) {
  const outcome = await db.transaction((tx) => recordDecision(tx, requestId, viewer, input, context));
  return { ...(await getRequestView(db, requestId, viewer)), outcome };
}

export function approveAndAllot(
  db: Database,
  requestId: string,
  viewer: Viewer,
  input: { remarks?: string; expectedUpdatedAt: string; reviewedCompetingRequestIds: string[] },
  context: RequestContext,
) {
  return confirmAllotment(db, viewer, {
    ...input,
    venueRequestId: requestId,
    conflictResolutionPolicy: 'AUTO_REJECT_CONFLICTS',
  }, context, (tx) =>
    recordDecision(tx, requestId, viewer, { decision: 'APPROVED', comments: input.remarks }, context));
}

function assertCurrentReview(updatedAt: Date, expectedUpdatedAt?: string) {
  if (expectedUpdatedAt && updatedAt.getTime() !== Date.parse(expectedUpdatedAt)) {
    throw new AppError(409, 'APPROVAL_STATE_CHANGED', 'This request changed. Review the updated details before deciding.');
  }
}

async function recordDecision(
  tx: DbExecutor,
  requestId: string,
  viewer: Viewer,
  input: ApprovalDecisionInput,
  context: RequestContext,
) {
  const { request, event, venue } = await loadLockedRequest(tx, requestId);
  if (!DECIDABLE_STATUSES.includes(request.status as (typeof DECIDABLE_STATUSES)[number])) {
    throw new AppError(
      409,
      'REQUEST_NOT_IN_REVIEW',
      'This request is no longer waiting for a preliminary decision.',
    );
  }

  const [instance] = await tx
    .select()
    .from(approvalInstances)
    .where(
      and(
        eq(approvalInstances.venueRequestId, requestId),
        eq(approvalInstances.isActive, true),
      ),
    )
    .for('update')
    .limit(1);
  if (!instance) {
    throw new AppError(409, 'NO_ACTIVE_APPROVAL', 'This request has no active approval round.');
  }
  if (
    instance.workflowId !== request.workflowId ||
    instance.currentStepOrder !== request.currentStepOrder
  ) {
    throw new AppError(
      409,
      'APPROVAL_STATE_CHANGED',
      'The approval state changed. Refresh the request and try again.',
    );
  }

  if (event.creatorId === viewer.userId || request.submittedById === viewer.userId) {
    throw new AppError(
      403,
      'SELF_APPROVAL_FORBIDDEN',
      'You cannot approve or reject your own request.',
    );
  }

  const now = new Date(Math.max(Date.now(), request.updatedAt.getTime() + 1));
  let nextStatus = request.status;
  let nextStepOrder = request.currentStepOrder;

  if (request.currentStepOrder === 0) {
    // Step 0: Faculty Coordinator Endorsement
    if (!viewer.isAdmin && event.facultyCoordinatorId !== viewer.userId) {
      throw new AppError(
        403,
        'APPROVAL_FORBIDDEN',
        'You are not the designated faculty coordinator for this event.',
      );
    }

    assertCurrentReview(request.updatedAt, input.expectedUpdatedAt);

    if (input.decision !== 'CHANGES_REQUESTED') {
      const [existingDecision] = await tx
        .select({ id: approvalDecisions.id, decision: approvalDecisions.decision })
        .from(approvalDecisions)
        .where(
          and(
            eq(approvalDecisions.approvalInstanceId, instance.id),
            eq(approvalDecisions.stepOrder, 0),
            eq(approvalDecisions.decision, input.decision),
          ),
        )
        .limit(1);
      if (existingDecision) {
        throw new AppError(
          409,
          'DUPLICATE_DECISION',
          'That decision has already been recorded for this stage.',
        );
      }
    }

    await tx.insert(approvalDecisions).values({
      approvalInstanceId: instance.id,
      workflowStepId: null,
      stepOrder: 0,
      stepName: 'Faculty Coordinator Endorsement',
      approverId: viewer.userId,
      decision: input.decision,
      remarks: input.comments || null,
      decidedAt: now,
    });

    if (input.decision === 'REJECTED') {
      await tx
        .update(approvalInstances)
        .set({ isActive: false, isCompleted: true, updatedAt: now })
        .where(eq(approvalInstances.id, instance.id));
      await tx
        .update(venueRequests)
        .set({
          status: 'REJECTED',
          rejectionReason: input.comments || null,
          updatedAt: now,
        })
        .where(eq(venueRequests.id, requestId));
      nextStatus = 'REJECTED';
    } else if (input.decision === 'CHANGES_REQUESTED') {
      await tx
        .update(venueRequests)
        .set({ status: 'SUBMITTED', rejectionReason: null, updatedAt: now })
        .where(eq(venueRequests.id, requestId));
      nextStatus = 'SUBMITTED';
    } else {
      // APPROVED (Endorsed): Advance to venue workflow (Step 1)
      const steps = await tx
        .select({ stepOrder: workflowSteps.stepOrder })
        .from(workflowSteps)
        .where(eq(workflowSteps.workflowId, request.workflowId))
        .orderBy(asc(workflowSteps.stepOrder))
        .limit(1);

      const firstWorkflowStep = steps[0];
      if (firstWorkflowStep) {
        await tx
          .update(approvalInstances)
          .set({ currentStepOrder: firstWorkflowStep.stepOrder, updatedAt: now })
          .where(eq(approvalInstances.id, instance.id));
        await tx
          .update(venueRequests)
          .set({
            status: 'IN_REVIEW',
            currentStepOrder: firstWorkflowStep.stepOrder,
            facultyEndorserId: viewer.userId,
            facultyEndorsedAt: now,
            rejectionReason: null,
            updatedAt: now,
          })
          .where(eq(venueRequests.id, requestId));
        nextStatus = 'IN_REVIEW';
        nextStepOrder = firstWorkflowStep.stepOrder;
      } else {
        await tx
          .update(approvalInstances)
          .set({ isActive: false, isCompleted: true, updatedAt: now })
          .where(eq(approvalInstances.id, instance.id));
        await tx
          .update(venueRequests)
          .set({
            status: 'APPROVED_PENDING_ALLOTMENT',
            facultyEndorserId: viewer.userId,
            facultyEndorsedAt: now,
            rejectionReason: null,
            updatedAt: now,
          })
          .where(eq(venueRequests.id, requestId));
        nextStatus = 'APPROVED_PENDING_ALLOTMENT';
      }
    }
  } else {
    // Step 1..N: Configured venue workflow steps
    const [step] = await tx
      .select()
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.workflowId, request.workflowId),
          eq(workflowSteps.stepOrder, request.currentStepOrder),
        ),
      )
      .limit(1);
    if (!step) {
      throw new AppError(409, 'APPROVAL_STEP_MISSING', 'The current approval step is not configured.');
    }

    const viewerRoles: ViewerRole[] = await loadViewerRoles(tx, viewer.userId);
    if (
      !eligibleForStep(
        viewerRoles,
        { requiredRole: step.requiredRole, scopeType: step.scopeType },
        event.departmentId,
        venue.departmentId,
      )
    ) {
      throw new AppError(
        403,
        'APPROVAL_FORBIDDEN',
        'You are not the authorized approver for this stage.',
      );
    }

    const isCollaborator = await isEventCollaborator(tx, event.id, viewer.userId);
    if (event.facultyCoordinatorId === viewer.userId || isCollaborator) {
      throw new AppError(
        403,
        'SELF_APPROVAL_FORBIDDEN',
        'Event organizers and coordinators cannot approve or reject their own event.',
      );
    }

    assertCurrentReview(request.updatedAt, input.expectedUpdatedAt);

    if (input.decision !== 'CHANGES_REQUESTED') {
      const [existingDecision] = await tx
        .select({ id: approvalDecisions.id, decision: approvalDecisions.decision })
        .from(approvalDecisions)
        .where(
          and(
            eq(approvalDecisions.approvalInstanceId, instance.id),
            eq(approvalDecisions.stepOrder, step.stepOrder),
            eq(approvalDecisions.decision, input.decision),
          ),
        )
        .limit(1);
      if (existingDecision) {
        throw new AppError(
          409,
          'DUPLICATE_DECISION',
          'That decision has already been recorded for this stage.',
        );
      }
    }

    await tx.insert(approvalDecisions).values({
      approvalInstanceId: instance.id,
      workflowStepId: step.id,
      stepOrder: step.stepOrder,
      stepName: step.stepName,
      approverId: viewer.userId,
      decision: input.decision,
      remarks: input.comments || null,
      decidedAt: now,
    });

    if (input.decision === 'REJECTED') {
      await tx
        .update(approvalInstances)
        .set({ isActive: false, isCompleted: true, updatedAt: now })
        .where(eq(approvalInstances.id, instance.id));
      await tx
        .update(venueRequests)
        .set({
          status: 'REJECTED',
          rejectionReason: input.comments || null,
          updatedAt: now,
        })
        .where(eq(venueRequests.id, requestId));
      nextStatus = 'REJECTED';
    } else if (input.decision === 'CHANGES_REQUESTED') {
      await tx
        .update(venueRequests)
        .set({ status: 'SUBMITTED', rejectionReason: null, updatedAt: now })
        .where(eq(venueRequests.id, requestId));
      nextStatus = 'SUBMITTED';
    } else {
      const [nextStep] = await tx
        .select({ stepOrder: workflowSteps.stepOrder })
        .from(workflowSteps)
        .where(
          and(
            eq(workflowSteps.workflowId, request.workflowId),
            gt(workflowSteps.stepOrder, step.stepOrder),
          ),
        )
        .orderBy(asc(workflowSteps.stepOrder))
        .limit(1);

      if (nextStep) {
        await tx
          .update(approvalInstances)
          .set({ currentStepOrder: nextStep.stepOrder, updatedAt: now })
          .where(eq(approvalInstances.id, instance.id));
        await tx
          .update(venueRequests)
          .set({
            status: 'IN_REVIEW',
            currentStepOrder: nextStep.stepOrder,
            rejectionReason: null,
            updatedAt: now,
          })
          .where(eq(venueRequests.id, requestId));
        nextStatus = 'IN_REVIEW';
        nextStepOrder = nextStep.stepOrder;
      } else {
        await tx
          .update(approvalInstances)
          .set({ isActive: false, isCompleted: true, updatedAt: now })
          .where(eq(approvalInstances.id, instance.id));
        await tx
          .update(venueRequests)
          .set({
            status: 'APPROVED_PENDING_ALLOTMENT',
            rejectionReason: null,
            updatedAt: now,
          })
          .where(eq(venueRequests.id, requestId));
        nextStatus = 'APPROVED_PENDING_ALLOTMENT';
      }
    }
  }

  await writeAudit(tx, {
    actorId: viewer.userId,
    action:
      input.decision === 'APPROVED'
        ? request.currentStepOrder === 0
          ? 'FACULTY_ENDORSEMENT_APPROVED'
          : 'APPROVAL_APPROVED'
        : input.decision === 'REJECTED'
          ? request.currentStepOrder === 0
            ? 'FACULTY_ENDORSEMENT_REJECTED'
            : 'APPROVAL_REJECTED'
          : request.currentStepOrder === 0
            ? 'FACULTY_ENDORSEMENT_CHANGES_REQUESTED'
            : 'APPROVAL_CHANGES_REQUESTED',
    entityName: 'venue_requests',
    entityId: requestId,
    oldState: {
      status: request.status,
      currentStepOrder: request.currentStepOrder,
    },
    newState: {
      status: nextStatus,
      currentStepOrder: nextStepOrder,
      decision: input.decision,
    },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  await notifyRequestParticipants(tx, requestId, {
    type: `APPROVAL_${input.decision}`,
    subject: `Approval update: ${event.title}`,
    body:
      input.decision === 'APPROVED'
        ? `Your venue request for “${event.title}” passed ${request.currentStepOrder === 0 ? 'faculty endorsement' : 'an approval stage'}.`
        : input.decision === 'REJECTED'
          ? `Your venue request for “${event.title}” was rejected. ${input.comments ?? ''}`.trim()
          : `Changes were requested for “${event.title}”. ${input.comments ?? ''}`.trim(),
    excludeUserId: viewer.userId,
    payload: { decision: input.decision, status: nextStatus },
  });

  return { status: nextStatus, finalised: nextStatus === 'APPROVED_PENDING_ALLOTMENT' };
}
