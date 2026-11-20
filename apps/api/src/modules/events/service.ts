import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { EventInput, EventUpdateInput } from '@venue/shared';
import type { Database, DbExecutor } from '../../db/index.js';
import {
  approvalInstances,
  departments,
  events,
  venueAllotments,
  venueRequests,
  venues,
} from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import {
  mapRequestRow,
  requestSelection,
  type EventSummary,
  type EventView,
} from '../requests/view.js';

const eventSelection = {
  id: events.id,
  title: events.title,
  description: events.description,
  expectedAttendance: events.expectedAttendance,
  status: events.status,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
  creatorId: events.creatorId,
  departmentId: departments.id,
  departmentCode: departments.code,
  departmentName: departments.name,
};

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  expectedAttendance: number;
  status: EventSummary['status'];
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
};

function mapEventSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    expectedAttendance: row.expectedAttendance,
    status: row.status,
    department: { id: row.departmentId, code: row.departmentCode, name: row.departmentName },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadRequests(db: DbExecutor, eventIds: string[]) {
  if (eventIds.length === 0) return new Map<string, ReturnType<typeof mapRequestRow>[]>();
  const rows = await db
    .select(requestSelection)
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .where(inArray(venueRequests.eventId, eventIds))
    .orderBy(desc(venueRequests.createdAt));
  const grouped = new Map<string, ReturnType<typeof mapRequestRow>[]>();
  for (const row of rows) {
    const request = mapRequestRow(row);
    const list = grouped.get(row.eventId) ?? [];
    list.push(request);
    grouped.set(row.eventId, list);
  }
  return grouped;
}

function toEventView(row: EventRow, requests: ReturnType<typeof mapRequestRow>[]): EventView {
  return { ...mapEventSummary(row), requests };
}

export async function listMyEvents(db: Database, userId: string) {
  const rows = await db
    .select(eventSelection)
    .from(events)
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .where(eq(events.creatorId, userId))
    .orderBy(desc(events.createdAt))
    .limit(100);
  const requests = await loadRequests(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toEventView(row, requests.get(row.id) ?? []));
}

interface Viewer {
  userId: string;
  isAdmin: boolean;
}

async function findEventRow(db: DbExecutor, eventId: string, lock = false) {
  const query = db
    .select(eventSelection)
    .from(events)
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .where(eq(events.id, eventId));
  const [row] = lock ? await query.for('update') : await query.limit(1);
  if (!row) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found.');
  return row;
}

function assertOwner(row: EventRow, viewer: Viewer) {
  if (!viewer.isAdmin && row.creatorId !== viewer.userId) {
    throw new AppError(403, 'EVENT_FORBIDDEN', 'You can only manage your own events.');
  }
}

export async function getEventView(db: Database, eventId: string, viewer: Viewer) {
  const row = await findEventRow(db, eventId);
  assertOwner(row, viewer);
  const requests = await loadRequests(db, [eventId]);
  return toEventView(row, requests.get(eventId) ?? []);
}

async function requireDepartment(db: DbExecutor, departmentId: string) {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .limit(1);
  if (!row) throw new AppError(400, 'DEPARTMENT_NOT_FOUND', 'Department not found.');
  return row.id;
}

export async function createEvent(
  db: Database,
  viewer: Viewer & { departmentId: string },
  input: EventInput,
  context: { ipAddress?: string; userAgent?: string },
) {
  const departmentId = input.departmentId ?? viewer.departmentId;
  if (!viewer.isAdmin && departmentId !== viewer.departmentId) {
    throw new AppError(403, 'DEPARTMENT_FORBIDDEN', 'Create events in your own department.');
  }
  await requireDepartment(db, departmentId);

  const eventId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(events)
      .values({
        title: input.title,
        description: input.description || null,
        expectedAttendance: input.expectedAttendance,
        departmentId,
        creatorId: viewer.userId,
      })
      .returning({ id: events.id });
    if (!created) throw new Error('Event insert returned no row.');

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'EVENT_CREATED',
      entityName: 'events',
      entityId: created.id,
      newState: { title: input.title, expectedAttendance: input.expectedAttendance },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return created.id;
  });

  return getEventView(db, eventId, viewer);
}

export async function updateEvent(
  db: Database,
  eventId: string,
  viewer: Viewer,
  input: EventUpdateInput,
  context: { ipAddress?: string; userAgent?: string },
) {
  await db.transaction(async (tx) => {
    const row = await findEventRow(tx, eventId, true);
    assertOwner(row, viewer);
    if (row.status === 'CANCELLED' || row.status === 'COMPLETED') {
      throw new AppError(409, 'EVENT_CLOSED', 'This event can no longer be edited.');
    }

    if (input.departmentId !== undefined && input.departmentId !== row.departmentId) {
      if (!viewer.isAdmin) {
        throw new AppError(403, 'DEPARTMENT_FORBIDDEN', 'You cannot move an event to another department.');
      }
      if (row.status !== 'DRAFT') {
        throw new AppError(409, 'EVENT_DEPARTMENT_LOCKED', 'Department cannot change after submission.');
      }
      await requireDepartment(tx, input.departmentId);
    }

    const attendance = input.expectedAttendance ?? row.expectedAttendance;
    if (input.expectedAttendance !== undefined) {
      const [capacity] = await tx
        .select({ value: sql<number>`min(${venues.capacity})` })
        .from(venueRequests)
        .innerJoin(venues, eq(venues.id, venueRequests.venueId))
        .where(
          and(
            eq(venueRequests.eventId, eventId),
            inArray(venueRequests.status, [
              'SUBMITTED',
              'IN_REVIEW',
              'APPROVED_PENDING_ALLOTMENT',
              'CONFIRMED',
            ]),
          ),
        );
      if (capacity?.value !== undefined && attendance > Number(capacity.value)) {
        throw new AppError(
          400,
          'CAPACITY_EXCEEDED',
          `This event has a venue booked for ${capacity.value} people or fewer.`,
        );
      }
    }

    await tx
      .update(events)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.expectedAttendance !== undefined
          ? { expectedAttendance: input.expectedAttendance }
          : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId));

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'EVENT_UPDATED',
      entityName: 'events',
      entityId: eventId,
      oldState: {
        title: row.title,
        description: row.description,
        expectedAttendance: row.expectedAttendance,
      },
      newState: input as Record<string, unknown>,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return getEventView(db, eventId, viewer);
}

const OPEN_REQUEST_STATUSES = [
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED_PENDING_ALLOTMENT',
  'CONFIRMED',
] as const;

export async function cancelEvent(
  db: Database,
  eventId: string,
  viewer: Viewer,
  context: { ipAddress?: string; userAgent?: string },
) {
  await db.transaction(async (tx) => {
    const row = await findEventRow(tx, eventId, true);
    assertOwner(row, viewer);
    if (row.status === 'COMPLETED') {
      throw new AppError(409, 'EVENT_COMPLETED', 'A completed event cannot be cancelled.');
    }
    if (row.status === 'CANCELLED') return;

    const requests = await tx
      .select({ id: venueRequests.id, status: venueRequests.status })
      .from(venueRequests)
      .where(and(eq(venueRequests.eventId, eventId), inArray(venueRequests.status, [...OPEN_REQUEST_STATUSES])))
      .for('update');

    const now = new Date();
    for (const request of requests) {
      await tx
        .update(approvalInstances)
        .set({ isActive: false, updatedAt: now })
        .where(and(eq(approvalInstances.venueRequestId, request.id), eq(approvalInstances.isActive, true)));
      await tx
        .update(venueAllotments)
        .set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancellationReason: 'Event cancelled by organizer.',
        })
        .where(and(eq(venueAllotments.venueRequestId, request.id), eq(venueAllotments.status, 'ACTIVE')));
      await tx
        .update(venueRequests)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(eq(venueRequests.id, request.id));
      await writeAudit(tx, {
        actorId: viewer.userId,
        action: 'VENUE_REQUEST_CANCELLED',
        entityName: 'venue_requests',
        entityId: request.id,
        oldState: { status: request.status },
        newState: { status: 'CANCELLED', reason: 'Event cancelled by organizer.' },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }

    await tx
      .update(events)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(eq(events.id, eventId));

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'EVENT_CANCELLED',
      entityName: 'events',
      entityId: eventId,
      newState: { status: 'CANCELLED', cancelledRequests: requests.length },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return getEventView(db, eventId, viewer);
}
