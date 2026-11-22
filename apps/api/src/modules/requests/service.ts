import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  ApprovalDecision,
  RequestStatus,
  RoleName,
  WorkflowScopeType,
} from '@venue/shared';
import type { Database, DbExecutor } from '../../db/index.js';
import {
  approvalDecisions,
  approvalInstances,
  approvalWorkflows,
  departments,
  events,
  users,
  venueAllotments,
  venueRequests,
  venues,
  workflowSteps,
} from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { assertBookingInterval, bufferedRange, parseInstant } from '../../lib/booking.js';
import { AppError } from '../../lib/errors.js';
import {
  effectiveStepScope,
  eligibleForStep,
  isWorkflowParticipant,
  loadViewerRoles,
} from '../approvals/eligibility.js';
import { loadWorkflowSteps, resolveWorkflowId } from '../workflows/service.js';
import {
  mapRequestRow,
  requestSelection,
  type EventSummary,
  type RequestRow,
} from './view.js';
import { isEventCollaborator } from '../events/service.js';

interface Viewer {
  userId: string;
  isAdmin: boolean;
}

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

const OPEN_REQUEST_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT'] as const;

interface RequestDetailRow extends RequestRow {
  creatorId: string;
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
  venueDepartmentId: string | null;
}

const requestDetailSelection = {
  ...requestSelection,
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
};

function eventSummary(row: RequestDetailRow): EventSummary {
  return {
    id: row.eventId,
    title: row.title,
    description: row.description,
    expectedAttendance: row.expectedAttendance,
    status: row.eventStatus,
    department: { id: row.departmentId, code: row.departmentCode, name: row.departmentName },
    facultyCoordinatorId: row.facultyCoordinatorId,
    createdAt: row.eventCreatedAt.toISOString(),
    updatedAt: row.eventUpdatedAt.toISOString(),
  };
}

async function loadRequestDetail(db: DbExecutor, requestId: string, lock = false) {
  const query = db
    .select(requestDetailSelection)
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .where(eq(venueRequests.id, requestId));
  const [row] = lock ? await query.for('update') : await query.limit(1);
  if (!row) throw new AppError(404, 'REQUEST_NOT_FOUND', 'Booking request not found.');
  return row;
}

async function assertRequestAccess(db: DbExecutor, row: RequestDetailRow, viewer: Viewer) {
  if (viewer.isAdmin) return;
  if (row.creatorId === viewer.userId) return;
  if (row.submittedById === viewer.userId) return;
  if (row.facultyCoordinatorId === viewer.userId) return;
  if (await isEventCollaborator(db, row.eventId, viewer.userId)) return;
  throw new AppError(404, 'REQUEST_NOT_FOUND', 'Booking request not found.');
}

export interface RequestConflictView {
  requestId: string;
  eventId: string;
  title: string;
  status: RequestStatus;
  startTime: string;
  endTime: string;
  rangeStart: string;
  rangeEnd: string;
  departmentCode?: string;
  departmentName?: string;
  expectedAttendance?: number;
}

export interface AllotmentView {
  id: string;
  status: 'ACTIVE' | 'CANCELLED' | 'RELEASED';
  reservedRange: string;
  allottedBy: { id: string; firstName: string; lastName: string; email: string };
  createdAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export interface ApprovalDecisionView {
  id: string;
  instanceId: string;
  round: number;
  stepOrder: number;
  stepName: string;
  decision: ApprovalDecision;
  remarks: string | null;
  approver: { id: string; firstName: string; lastName: string; email: string };
  decidedAt: string;
  isCurrentRound: boolean;
}

export interface ApprovalTimelineStep {
  id: string;
  stepOrder: number;
  stepName: string;
  requiredRole: RoleName;
  scopeType: WorkflowScopeType;
  isFinalAllotmentStep: boolean;
  state: ApprovalDecision | 'CURRENT' | 'PENDING';
  decision: ApprovalDecisionView | null;
}

export interface RequestDetailView {
  request: ReturnType<typeof mapRequestRow>;
  event: EventSummary;
  workflow: {
    id: string;
    name: string;
    description: string | null;
    steps: Omit<ApprovalTimelineStep, 'state' | 'decision'>[];
  };
  timeline: ApprovalTimelineStep[];
  decisions: ApprovalDecisionView[];
  conflicts: { confirmed: RequestConflictView[]; pending: RequestConflictView[] };
  currentRound: number | null;
  allotment?: AllotmentView | null;
  permissions: {
    canDecide: boolean;
    canApproveAndAllot: boolean;
    canEdit: boolean;
    canCancel: boolean;
    canAllot: boolean;
    requiresAllotmentRemarks: boolean;
    canCancelAllotment: boolean;
  };
}

interface ConflictQuery {
  venueId: string;
  startTime: Date;
  endTime: Date;
  setupBufferMins: number;
  teardownBufferMins: number;
  excludeRequestId: string;
}

export async function findRequestConflicts(
  db: DbExecutor,
  query: ConflictQuery,
): Promise<RequestDetailView['conflicts']> {
  const rangeStart = new Date(query.startTime.getTime() - query.setupBufferMins * 60_000);
  const rangeEnd = new Date(query.endTime.getTime() + query.teardownBufferMins * 60_000);

  const confirmedRows = await db
    .select({
      requestId: venueRequests.id,
      eventId: events.id,
      title: events.title,
      status: venueRequests.status,
      startTime: venueRequests.startTime,
      endTime: venueRequests.endTime,
      setupBufferMins: venueRequests.setupBufferMins,
      teardownBufferMins: venueRequests.teardownBufferMins,
      expectedAttendance: events.expectedAttendance,
      departmentCode: departments.code,
      departmentName: departments.name,
    })
    .from(venueAllotments)
    .innerJoin(venueRequests, eq(venueRequests.id, venueAllotments.venueRequestId))
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .where(
      and(
        eq(venueAllotments.venueId, query.venueId),
        eq(venueAllotments.status, 'ACTIVE'),
        ne(venueAllotments.venueRequestId, query.excludeRequestId),
        sql`${venueAllotments.reservedRange} && tstzrange(${rangeStart}, ${rangeEnd}, '[)')`,
      ),
    )
    .orderBy(asc(venueRequests.startTime));

  const pendingRows = await db
    .select({
      requestId: venueRequests.id,
      eventId: events.id,
      title: events.title,
      status: venueRequests.status,
      startTime: venueRequests.startTime,
      endTime: venueRequests.endTime,
      setupBufferMins: venueRequests.setupBufferMins,
      teardownBufferMins: venueRequests.teardownBufferMins,
      expectedAttendance: events.expectedAttendance,
      departmentCode: departments.code,
      departmentName: departments.name,
    })
    .from(venueRequests)
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .where(
      and(
        eq(venueRequests.venueId, query.venueId),
        ne(venueRequests.id, query.excludeRequestId),
        inArray(venueRequests.status, ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT']),
        sql`${venueRequests.effectiveRange} && tstzrange(${rangeStart}, ${rangeEnd}, '[)')`,
      ),
    )
    .orderBy(asc(venueRequests.startTime));

  const mapConflict = (
    row: (typeof confirmedRows)[number] | (typeof pendingRows)[number],
  ): RequestConflictView => ({
    requestId: row.requestId,
    eventId: row.eventId,
    title: row.title,
    status: row.status,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    rangeStart: new Date(
      row.startTime.getTime() - row.setupBufferMins * 60_000,
    ).toISOString(),
    rangeEnd: new Date(
      row.endTime.getTime() + row.teardownBufferMins * 60_000,
    ).toISOString(),
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    expectedAttendance: row.expectedAttendance,
  });

  return {
    confirmed: confirmedRows.map(mapConflict),
    pending: pendingRows.map(mapConflict),
  };
}

export async function getRequestView(
  db: Database,
  requestId: string,
  viewer: Viewer,
): Promise<RequestDetailView> {
  const row = await loadRequestDetail(db, requestId);
  const [workflow] = await db
    .select()
    .from(approvalWorkflows)
    .where(eq(approvalWorkflows.id, row.workflowId))
    .limit(1);
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowId, row.workflowId))
    .orderBy(asc(workflowSteps.stepOrder));
  const viewerRoles = await loadViewerRoles(db, viewer.userId);
  const isOrganizer = await isEventCollaborator(db, row.eventId, viewer.userId);
  const participant =
    row.creatorId === viewer.userId ||
    row.submittedById === viewer.userId ||
    row.facultyCoordinatorId === viewer.userId ||
    isOrganizer ||
    viewer.isAdmin ||
    isWorkflowParticipant(viewerRoles, steps, row.departmentId, row.venueDepartmentId);

  let hasDecided = false;
  if (!participant) {
    const [previous] = await db
      .select({ id: approvalDecisions.id })
      .from(approvalDecisions)
      .innerJoin(
        approvalInstances,
        eq(approvalInstances.id, approvalDecisions.approvalInstanceId),
      )
      .where(
        and(
          eq(approvalInstances.venueRequestId, requestId),
          eq(approvalDecisions.approverId, viewer.userId),
        ),
      )
      .limit(1);
    hasDecided = Boolean(previous);
  }
  if (!participant && !hasDecided) {
    throw new AppError(404, 'REQUEST_NOT_FOUND', 'Booking request not found.');
  }

  const instances = await db
    .select()
    .from(approvalInstances)
    .where(eq(approvalInstances.venueRequestId, requestId))
    .orderBy(asc(approvalInstances.createdAt));
  const currentInstance =
    [...instances].reverse().find((instance) => instance.isActive) ??
    instances[instances.length - 1] ??
    null;
  const roundByInstance = new Map(
    instances.map((instance, index) => [instance.id, index + 1]),
  );

  const decisionRows =
    instances.length === 0
      ? []
      : await db
          .select({
            id: approvalDecisions.id,
            instanceId: approvalDecisions.approvalInstanceId,
            stepOrder: approvalDecisions.stepOrder,
            stepName: approvalDecisions.stepName,
            decision: approvalDecisions.decision,
            remarks: approvalDecisions.remarks,
            decidedAt: approvalDecisions.decidedAt,
            approverId: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
          })
          .from(approvalDecisions)
          .innerJoin(
            approvalInstances,
            eq(approvalInstances.id, approvalDecisions.approvalInstanceId),
          )
          .innerJoin(users, eq(users.id, approvalDecisions.approverId))
          .where(
            inArray(
              approvalDecisions.approvalInstanceId,
              instances.map((instance) => instance.id),
            ),
          )
          .orderBy(asc(approvalDecisions.decidedAt));

  const decisions: ApprovalDecisionView[] = decisionRows.map((decision) => ({
    id: decision.id,
    instanceId: decision.instanceId,
    round: roundByInstance.get(decision.instanceId) ?? 1,
    stepOrder: decision.stepOrder,
    stepName: decision.stepName,
    decision: decision.decision,
    remarks: decision.remarks,
    approver: {
      id: decision.approverId,
      firstName: decision.firstName,
      lastName: decision.lastName,
      email: decision.email,
    },
    decidedAt: decision.decidedAt.toISOString(),
    isCurrentRound: currentInstance?.id === decision.instanceId,
  }));

  const currentRoundDecisions = currentInstance
    ? decisions.filter((decision) => decision.instanceId === currentInstance.id)
    : [];
  const latestByStep = new Map<number, ApprovalDecisionView>();
  for (const decision of currentRoundDecisions) {
    latestByStep.set(decision.stepOrder, decision);
  }
  const requestOpen = row.status === 'SUBMITTED' || row.status === 'IN_REVIEW';

  const timeline: ApprovalTimelineStep[] = [];
  if (row.requiresFacultyEndorsement) {
    const step0Decision = latestByStep.get(0) ?? null;
    let step0State: ApprovalTimelineStep['state'] = 'PENDING';
    if (step0Decision) {
      step0State = step0Decision.decision;
    } else if (row.facultyEndorsedAt) {
      step0State = 'APPROVED';
    } else if (row.currentStepOrder === 0 && requestOpen) {
      step0State = 'CURRENT';
    } else if (row.status === 'REJECTED' && row.currentStepOrder === 0) {
      step0State = 'REJECTED';
    }

    timeline.push({
      id: 'faculty-endorsement',
      stepOrder: 0,
      stepName: 'Faculty Coordinator Endorsement',
      requiredRole: 'FACULTY',
      scopeType: 'CREATOR_DEPARTMENT',
      isFinalAllotmentStep: false,
      state: step0State,
      decision: step0Decision,
    });
  }

  for (const step of steps) {
    const decision = latestByStep.get(step.stepOrder) ?? null;
    timeline.push({
      id: step.id,
      stepOrder: step.stepOrder,
      stepName: step.stepName,
      requiredRole: step.requiredRole,
      scopeType: effectiveStepScope(step, row.venueDepartmentId),
      isFinalAllotmentStep: step.isFinalAllotmentStep,
      state:
        decision?.decision ??
        (requestOpen && step.stepOrder === row.currentStepOrder ? 'CURRENT' : 'PENDING'),
      decision,
    });
  }

  const currentStep = steps.find((step) => step.stepOrder === row.currentStepOrder) ?? null;
  let canDecide = false;
  if (requestOpen && currentInstance?.isActive) {
    if (row.currentStepOrder === 0) {
      canDecide =
        (viewer.isAdmin || row.facultyCoordinatorId === viewer.userId) &&
        row.creatorId !== viewer.userId &&
        row.submittedById !== viewer.userId;
    } else if (currentStep) {
      canDecide =
        row.creatorId !== viewer.userId &&
        row.submittedById !== viewer.userId &&
        row.facultyCoordinatorId !== viewer.userId &&
        !isOrganizer &&
        eligibleForStep(viewerRoles, currentStep, row.departmentId, row.venueDepartmentId);
    }
  }

  const closed = ['REJECTED', 'CANCELLED', 'SUPERSEDED_CONFLICT'].includes(row.status);
  const ownerOrAdmin =
    viewer.isAdmin ||
    row.creatorId === viewer.userId ||
    row.submittedById === viewer.userId ||
    isOrganizer;

  const finalStep = steps.find((s) => s.isFinalAllotmentStep) ?? steps[steps.length - 1];
  const isFinalEligible = finalStep
    ? eligibleForStep(viewerRoles, finalStep, row.departmentId, row.venueDepartmentId)
    : viewer.isAdmin;

  const canAllot = Boolean(
    row.status === 'APPROVED_PENDING_ALLOTMENT' &&
      row.creatorId !== viewer.userId &&
      row.submittedById !== viewer.userId &&
      row.facultyCoordinatorId !== viewer.userId &&
      !isOrganizer &&
      (isFinalEligible || viewer.isAdmin),
  );

  const [allotmentRow] = await db
    .select({
      id: venueAllotments.id,
      status: venueAllotments.status,
      reservedRange: sql<string>`${venueAllotments.reservedRange}::text`,
      createdAt: venueAllotments.createdAt,
      cancelledAt: venueAllotments.cancelledAt,
      cancellationReason: venueAllotments.cancellationReason,
      allottedById: users.id,
      allottedByFirstName: users.firstName,
      allottedByLastName: users.lastName,
      allottedByEmail: users.email,
    })
    .from(venueAllotments)
    .innerJoin(users, eq(users.id, venueAllotments.allottedBy))
    .where(eq(venueAllotments.venueRequestId, requestId))
    .limit(1);

  const allotment: AllotmentView | null = allotmentRow
    ? {
        id: allotmentRow.id,
        status: allotmentRow.status,
        reservedRange: allotmentRow.reservedRange,
        allottedBy: {
          id: allotmentRow.allottedById,
          firstName: allotmentRow.allottedByFirstName,
          lastName: allotmentRow.allottedByLastName,
          email: allotmentRow.allottedByEmail,
        },
        createdAt: allotmentRow.createdAt.toISOString(),
        cancelledAt: allotmentRow.cancelledAt?.toISOString() ?? null,
        cancellationReason: allotmentRow.cancellationReason,
      }
    : null;

  const canCancelAllotment = Boolean(
    allotment &&
      allotment.status === 'ACTIVE' &&
      (viewer.isAdmin || row.creatorId === viewer.userId || allotmentRow?.allottedById === viewer.userId),
  );

  return {
    request: mapRequestRow(row),
    event: eventSummary(row),
    workflow: {
      id: row.workflowId,
      name: workflow?.name ?? 'Approval workflow',
      description: workflow?.description ?? null,
      steps: steps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        stepName: step.stepName,
        requiredRole: step.requiredRole,
        scopeType: effectiveStepScope(step, row.venueDepartmentId),
        isFinalAllotmentStep: step.isFinalAllotmentStep,
      })),
    },
    timeline,
    decisions,
    conflicts: await findRequestConflicts(db, {
      venueId: row.venueId,
      startTime: row.startTime,
      endTime: row.endTime,
      setupBufferMins: row.setupBufferMins,
      teardownBufferMins: row.teardownBufferMins,
      excludeRequestId: row.id,
    }),
    currentRound: currentInstance ? (roundByInstance.get(currentInstance.id) ?? 1) : null,
    allotment,
    permissions: {
      canDecide,
      canApproveAndAllot: Boolean(canDecide && currentStep &&
        currentStep.id === finalStep?.id && currentStep.id === steps.at(-1)?.id),
      canEdit: ownerOrAdmin && !closed,
      canCancel: ownerOrAdmin && !closed,
      canAllot,
      requiresAllotmentRemarks: viewer.isAdmin && (!finalStep ||
        !eligibleForStep(viewerRoles, finalStep, row.departmentId, row.venueDepartmentId, false)),
      canCancelAllotment,
    },
  };
}

async function loadVenueForBooking(db: DbExecutor, venueId: string) {
  const [venue] = await db
    .select({
      id: venues.id,
      name: venues.name,
      capacity: venues.capacity,
      departmentId: venues.departmentId,
      isActive: venues.isActive,
      setupBufferMins: venues.setupBufferMins,
      teardownBufferMins: venues.teardownBufferMins,
      workflowId: venues.workflowId,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .for('share')
    .limit(1);
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Venue not found.');
  if (!venue.isActive) {
    throw new AppError(400, 'VENUE_UNAVAILABLE', 'This venue is not accepting bookings.');
  }
  return venue;
}

async function findConfirmedConflict(
  db: DbExecutor,
  venueId: string,
  start: Date,
  end: Date,
  excludeRequestId?: string,
) {
  const conditions = [
    eq(venueAllotments.venueId, venueId),
    eq(venueAllotments.status, 'ACTIVE'),
    sql`${venueAllotments.reservedRange} && tstzrange(${start}, ${end}, '[)')`,
  ];
  if (excludeRequestId) conditions.push(ne(venueAllotments.venueRequestId, excludeRequestId));
  const [conflict] = await db
    .select({ id: venueAllotments.id })
    .from(venueAllotments)
    .where(and(...conditions))
    .limit(1);
  return conflict ?? null;
}

export async function loadBookingWorkflow(db: DbExecutor, venue: { workflowId: string | null; departmentId: string | null }) {
  const resolvedId = await resolveWorkflowId(db, venue.workflowId);
  const steps = await loadWorkflowSteps(db, resolvedId);
  if (!venue.departmentId && steps.some((step) => step.scopeType === 'VENUE_DEPARTMENT')) {
    throw new AppError(
      409,
      'VENUE_WORKFLOW_SCOPE_INVALID',
      'This college-wide venue has a department-scoped approval step. Ask an administrator to update its approval workflow.',
    );
  }
  return { workflowId: resolvedId, firstStepOrder: steps[0]!.stepOrder, steps };
}

export async function createVenueRequest(
  db: Database,
  viewer: Viewer,
  input: { eventId: string; venueId: string; startTime: string; endTime: string },
  context: RequestContext,
) {
  const start = parseInstant(input.startTime, 'start time');
  const end = parseInstant(input.endTime, 'end time');

  const requestId = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({
        id: events.id,
        creatorId: events.creatorId,
        facultyCoordinatorId: events.facultyCoordinatorId,
        status: events.status,
        expectedAttendance: events.expectedAttendance,
      })
      .from(events)
      .where(eq(events.id, input.eventId))
      .for('update')
      .limit(1);
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found.');

    const isOrganizer = await isEventCollaborator(tx, event.id, viewer.userId);
    const canSubmit =
      viewer.isAdmin ||
      event.creatorId === viewer.userId ||
      event.facultyCoordinatorId === viewer.userId ||
      isOrganizer;

    if (!canSubmit) {
      throw new AppError(
        403,
        'EVENT_ACCESS_FORBIDDEN',
        'You are not authorized to submit venue requests for this event.',
      );
    }
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new AppError(409, 'EVENT_CLOSED', 'This event is closed and cannot be booked.');
    }
    if (event.status !== 'DRAFT') {
      const [activeReq] = await tx
        .select({ id: venueRequests.id })
        .from(venueRequests)
        .where(
          and(
            eq(venueRequests.eventId, event.id),
            inArray(venueRequests.status, [
              'SUBMITTED',
              'IN_REVIEW',
              'APPROVED_PENDING_ALLOTMENT',
              'CONFIRMED',
            ]),
          ),
        )
        .limit(1);
      if (activeReq) {
        throw new AppError(
          409,
          'EVENT_ALREADY_SUBMITTED',
          'This event already has an active or confirmed booking request.',
        );
      }
    }

    assertBookingInterval(start, end);
    const venue = await loadVenueForBooking(tx, input.venueId);
    if (event.expectedAttendance > venue.capacity) {
      throw new AppError(
        400,
        'CAPACITY_EXCEEDED',
        `This venue holds ${venue.capacity} people; your event expects ${event.expectedAttendance}.`,
      );
    }

    const effective = bufferedRange(start, end, venue.setupBufferMins, venue.teardownBufferMins);
    if (await findConfirmedConflict(tx, venue.id, effective.start, effective.end)) {
      throw new AppError(
        409,
        'SLOT_ALREADY_CONFIRMED',
        'This venue is already confirmed for another event during that time.',
      );
    }

    const workflow = await loadBookingWorkflow(tx, venue);

    const callerRoles = await loadViewerRoles(tx, viewer.userId);
    const isFacultyOrAbove =
      viewer.isAdmin ||
      callerRoles.some((r) =>
        ['FACULTY', 'HOD', 'BURSAR', 'PRINCIPAL', 'ADMINISTRATOR'].includes(r.role),
      );

    let requiresFacultyEndorsement = false;
    let initialStepOrder = workflow.firstStepOrder;

    if (!isFacultyOrAbove) {
      if (!event.facultyCoordinatorId) {
        throw new AppError(
          400,
          'FACULTY_COORDINATOR_REQUIRED',
          'Every event must have a designated faculty coordinator before a student can submit a venue request.',
        );
      }
      requiresFacultyEndorsement = true;
      initialStepOrder = 0;
    }

    const [created] = await tx
      .insert(venueRequests)
      .values({
        eventId: event.id,
        submittedById: viewer.userId,
        requiresFacultyEndorsement,
        venueId: venue.id,
        workflowId: workflow.workflowId,
        startTime: start,
        endTime: end,
        setupBufferMins: venue.setupBufferMins,
        teardownBufferMins: venue.teardownBufferMins,
        currentStepOrder: initialStepOrder,
      })
      .returning({ id: venueRequests.id });
    if (!created) throw new Error('Venue request insert returned no row.');

    await tx.insert(approvalInstances).values({
      venueRequestId: created.id,
      workflowId: workflow.workflowId,
      currentStepOrder: initialStepOrder,
    });
    await tx
      .update(events)
      .set({ status: 'SUBMITTED', updatedAt: new Date() })
      .where(eq(events.id, event.id));

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'VENUE_REQUEST_SUBMITTED',
      entityName: 'venue_requests',
      entityId: created.id,
      newState: {
        eventId: event.id,
        venueId: venue.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        status: 'SUBMITTED',
        requiresFacultyEndorsement,
        initialStepOrder,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return created.id;
  });

  return getRequestView(db, requestId, viewer);
}

export async function updateVenueRequest(
  db: Database,
  requestId: string,
  viewer: Viewer,
  input: {
    venueId?: string;
    startTime?: string;
    endTime?: string;
    event?: {
      title?: string;
      description?: string;
      expectedAttendance?: number;
      departmentId?: string;
    };
  },
  context: RequestContext,
) {
  await db.transaction(async (tx) => {
    const row = await loadRequestDetail(tx, requestId, true);
    await assertRequestAccess(tx, row, viewer);

    if (['CANCELLED', 'REJECTED', 'SUPERSEDED_CONFLICT'].includes(row.status)) {
      throw new AppError(409, 'REQUEST_CLOSED', 'This request can no longer be edited.');
    }

    const nextVenueId = input.venueId ?? row.venueId;
    const nextStart = input.startTime ? parseInstant(input.startTime, 'start time') : row.startTime;
    const nextEnd = input.endTime ? parseInstant(input.endTime, 'end time') : row.endTime;
    const critical =
      nextVenueId !== row.venueId ||
      nextStart.getTime() !== row.startTime.getTime() ||
      nextEnd.getTime() !== row.endTime.getTime() ||
      (input.event?.departmentId !== undefined && input.event.departmentId !== row.departmentId);

    if (critical && row.status === 'CONFIRMED') {
      throw new AppError(
        409,
        'CONFIRMED_REQUEST_LOCKED',
        'Cancel the confirmed booking before changing its venue, date or time.',
      );
    }
    if (input.event?.departmentId !== undefined && input.event.departmentId !== row.departmentId) {
      if (!viewer.isAdmin) {
        throw new AppError(403, 'DEPARTMENT_FORBIDDEN', 'You cannot move an event to another department.');
      }
      if (row.eventStatus !== 'DRAFT') {
        throw new AppError(409, 'EVENT_DEPARTMENT_LOCKED', 'Department cannot change after submission.');
      }
    }

    const nextAttendance = input.event?.expectedAttendance ?? row.expectedAttendance;
    const venue = await loadVenueForBooking(tx, nextVenueId);
    if (nextAttendance > venue.capacity) {
      throw new AppError(
        400,
        'CAPACITY_EXCEEDED',
        `This venue holds ${venue.capacity} people; your event expects ${nextAttendance}.`,
      );
    }

    if (critical) {
      assertBookingInterval(nextStart, nextEnd);
      const effective = bufferedRange(nextStart, nextEnd, venue.setupBufferMins, venue.teardownBufferMins);
      if (await findConfirmedConflict(tx, venue.id, effective.start, effective.end, requestId)) {
        throw new AppError(
          409,
          'SLOT_ALREADY_CONFIRMED',
          'This venue is already confirmed for another event during that time.',
        );
      }
    }

    if (input.event) {
      await tx
        .update(events)
        .set({
          ...(input.event.title !== undefined ? { title: input.event.title } : {}),
          ...(input.event.description !== undefined
            ? { description: input.event.description || null }
            : {}),
          ...(input.event.expectedAttendance !== undefined
            ? { expectedAttendance: input.event.expectedAttendance }
            : {}),
          ...(input.event.departmentId !== undefined
            ? { departmentId: input.event.departmentId }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(events.id, row.eventId));
    }

    const now = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
    if (critical) {
      const targetWorkflow = await loadBookingWorkflow(tx, venue);
      const restartStepOrder = row.requiresFacultyEndorsement ? 0 : targetWorkflow.firstStepOrder;

      await tx
        .update(approvalInstances)
        .set({ isActive: false, updatedAt: now })
        .where(
          and(
            eq(approvalInstances.venueRequestId, requestId),
            eq(approvalInstances.isActive, true),
          ),
        );
      await tx.insert(approvalInstances).values({
        venueRequestId: requestId,
        workflowId: targetWorkflow.workflowId,
        currentStepOrder: restartStepOrder,
      });
      await tx
        .update(venueRequests)
        .set({
          venueId: nextVenueId,
          workflowId: targetWorkflow.workflowId,
          startTime: nextStart,
          endTime: nextEnd,
          setupBufferMins: venue.setupBufferMins,
          teardownBufferMins: venue.teardownBufferMins,
          status: 'SUBMITTED',
          currentStepOrder: restartStepOrder,
          facultyEndorserId: row.requiresFacultyEndorsement ? null : row.facultyEndorserId,
          facultyEndorsedAt: row.requiresFacultyEndorsement ? null : row.facultyEndorsedAt,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(eq(venueRequests.id, requestId));

      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'VENUE_REQUEST_RESUBMITTED',
        entityName: 'venue_requests',
        entityId: requestId,
        oldState: {
          venueId: row.venueId,
          startTime: row.startTime.toISOString(),
          endTime: row.endTime.toISOString(),
          status: row.status,
        },
        newState: {
          venueId: nextVenueId,
          startTime: nextStart.toISOString(),
          endTime: nextEnd.toISOString(),
          status: 'SUBMITTED',
          approvalsInvalidated: true,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    } else {
      await tx
        .update(venueRequests)
        .set({ updatedAt: now })
        .where(eq(venueRequests.id, requestId));
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'EVENT_UPDATED',
        entityName: 'events',
        entityId: row.eventId,
        newState: input.event as Record<string, unknown>,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }
  });

  return getRequestView(db, requestId, viewer);
}

export async function cancelVenueRequest(
  db: Database,
  requestId: string,
  viewer: Viewer,
  context: RequestContext,
) {
  await db.transaction(async (tx) => {
    const row = await loadRequestDetail(tx, requestId, true);
    await assertRequestAccess(tx, row, viewer);
    if (row.status === 'CANCELLED') return;
    if (row.status === 'REJECTED' || row.status === 'SUPERSEDED_CONFLICT') {
      throw new AppError(409, 'REQUEST_CLOSED', 'This request is already closed.');
    }

    const now = new Date();
    await tx
      .update(approvalInstances)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(approvalInstances.venueRequestId, requestId), eq(approvalInstances.isActive, true)));
    await tx
      .update(venueAllotments)
      .set({
        status: 'CANCELLED',
        cancelledAt: now,
        cancellationReason: 'Booking cancelled by organizer.',
      })
      .where(and(eq(venueAllotments.venueRequestId, requestId), eq(venueAllotments.status, 'ACTIVE')));
    await tx
      .update(venueRequests)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(eq(venueRequests.id, requestId));

    const [remaining] = await tx
      .select({ id: venueRequests.id })
      .from(venueRequests)
      .where(
        and(
          eq(venueRequests.eventId, row.eventId),
          ne(venueRequests.id, requestId),
          inArray(venueRequests.status, [...OPEN_REQUEST_STATUSES, 'CONFIRMED']),
        ),
      )
      .limit(1);
    if (!remaining) {
      await tx
        .update(events)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(eq(events.id, row.eventId));
    }

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'VENUE_REQUEST_CANCELLED',
      entityName: 'venue_requests',
      entityId: requestId,
      oldState: { status: row.status },
      newState: { status: 'CANCELLED' },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return getRequestView(db, requestId, viewer);
}
