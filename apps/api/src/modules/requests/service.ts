import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/index.js';
import {
  approvalInstances,
  approvalWorkflows,
  departments,
  events,
  venueAllotments,
  venueRequests,
  venues,
  workflowSteps,
} from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { assertBookingInterval, bufferedRange, parseInstant } from '../../lib/booking.js';
import { AppError } from '../../lib/errors.js';
import {
  mapRequestRow,
  requestSelection,
  type EventSummary,
  type RequestRow,
} from './view.js';

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

const requestDetailSelection = {
  ...requestSelection,
  creatorId: events.creatorId,
  title: events.title,
  description: events.description,
  expectedAttendance: events.expectedAttendance,
  eventStatus: events.status,
  eventCreatedAt: events.createdAt,
  eventUpdatedAt: events.updatedAt,
  departmentId: departments.id,
  departmentCode: departments.code,
  departmentName: departments.name,
};

function eventSummary(row: RequestDetailRow): EventSummary {
  return {
    id: row.eventId,
    title: row.title,
    description: row.description,
    expectedAttendance: row.expectedAttendance,
    status: row.eventStatus,
    department: { id: row.departmentId, code: row.departmentCode, name: row.departmentName },
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

function assertRequestAccess(row: RequestDetailRow, viewer: Viewer) {
  if (!viewer.isAdmin && row.creatorId !== viewer.userId) {
    throw new AppError(404, 'REQUEST_NOT_FOUND', 'Booking request not found.');
  }
}

export async function getRequestView(db: Database, requestId: string, viewer: Viewer) {
  const row = await loadRequestDetail(db, requestId);
  assertRequestAccess(row, viewer);
  return { request: mapRequestRow(row), event: eventSummary(row) };
}

async function loadVenueForBooking(db: DbExecutor, venueId: string) {
  const [venue] = await db
    .select({
      id: venues.id,
      name: venues.name,
      capacity: venues.capacity,
      isActive: venues.isActive,
      setupBufferMins: venues.setupBufferMins,
      teardownBufferMins: venues.teardownBufferMins,
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

async function loadWorkflow(db: DbExecutor) {
  const [workflow] = await db
    .select({ id: approvalWorkflows.id })
    .from(approvalWorkflows)
    .where(eq(approvalWorkflows.isDefault, true))
    .limit(1);
  if (!workflow) {
    throw new AppError(500, 'WORKFLOW_NOT_CONFIGURED', 'No default approval workflow is configured.');
  }
  const [step] = await db
    .select({ stepOrder: workflowSteps.stepOrder })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowId, workflow.id))
    .orderBy(workflowSteps.stepOrder)
    .limit(1);
  if (!step) {
    throw new AppError(500, 'WORKFLOW_NOT_CONFIGURED', 'The default approval workflow has no steps.');
  }
  return { workflowId: workflow.id, firstStepOrder: step.stepOrder };
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
        status: events.status,
        expectedAttendance: events.expectedAttendance,
      })
      .from(events)
      .where(eq(events.id, input.eventId))
      .for('update')
      .limit(1);
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found.');
    if (!viewer.isAdmin && event.creatorId !== viewer.userId) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found.');
    }
    if (event.status !== 'DRAFT') {
      throw new AppError(409, 'EVENT_ALREADY_SUBMITTED', 'This event has already been submitted.');
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

    const workflow = await loadWorkflow(tx);
    const [created] = await tx
      .insert(venueRequests)
      .values({
        eventId: event.id,
        venueId: venue.id,
        workflowId: workflow.workflowId,
        startTime: start,
        endTime: end,
        setupBufferMins: venue.setupBufferMins,
        teardownBufferMins: venue.teardownBufferMins,
        currentStepOrder: workflow.firstStepOrder,
      })
      .returning({ id: venueRequests.id });
    if (!created) throw new Error('Venue request insert returned no row.');

    await tx.insert(approvalInstances).values({
      venueRequestId: created.id,
      workflowId: workflow.workflowId,
      currentStepOrder: workflow.firstStepOrder,
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
    assertRequestAccess(row, viewer);

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

    const now = new Date();
    if (critical) {
      const [step] = await tx
        .select({ stepOrder: workflowSteps.stepOrder })
        .from(workflowSteps)
        .where(eq(workflowSteps.workflowId, row.workflowId ?? ''))
        .orderBy(workflowSteps.stepOrder)
        .limit(1);
      const firstStepOrder = step?.stepOrder ?? 1;

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
        workflowId: row.workflowId,
        currentStepOrder: firstStepOrder,
      });
      await tx
        .update(venueRequests)
        .set({
          venueId: nextVenueId,
          startTime: nextStart,
          endTime: nextEnd,
          setupBufferMins: venue.setupBufferMins,
          teardownBufferMins: venue.teardownBufferMins,
          status: 'SUBMITTED',
          currentStepOrder: firstStepOrder,
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
    assertRequestAccess(row, viewer);
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
