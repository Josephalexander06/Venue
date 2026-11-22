import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type {
  EventCoordinatorInput,
  EventInput,
  EventOrganizerInput,
  EventTeamMember,
  EventTeamView,
  EventUpdateInput,
} from '@venue/shared';
import type { Database, DbExecutor } from '../../db/index.js';
import {
  approvalInstances,
  departments,
  eventOrganizers,
  events,
  roles,
  userRoles,
  users,
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
  facultyCoordinatorId: events.facultyCoordinatorId,
  departmentId: departments.id,
  departmentCode: departments.code,
  departmentName: departments.name,
  coordinatorFirstName: users.firstName,
  coordinatorLastName: users.lastName,
  coordinatorEmail: users.email,
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
  facultyCoordinatorId: string | null;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  coordinatorFirstName: string | null;
  coordinatorLastName: string | null;
  coordinatorEmail: string | null;
};

function mapEventSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    expectedAttendance: row.expectedAttendance,
    status: row.status,
    department: { id: row.departmentId, code: row.departmentCode, name: row.departmentName },
    facultyCoordinatorId: row.facultyCoordinatorId,
    facultyCoordinator:
      row.facultyCoordinatorId && row.coordinatorEmail
        ? {
            id: row.facultyCoordinatorId,
            firstName: row.coordinatorFirstName ?? '',
            lastName: row.coordinatorLastName ?? '',
            email: row.coordinatorEmail,
          }
        : null,
    creatorId: row.creatorId,
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

export async function isEventCollaborator(
  db: DbExecutor,
  eventId: string,
  userId: string,
): Promise<boolean> {
  const [organizer] = await db
    .select({ id: eventOrganizers.id })
    .from(eventOrganizers)
    .where(and(eq(eventOrganizers.eventId, eventId), eq(eventOrganizers.userId, userId)))
    .limit(1);
  return Boolean(organizer);
}

export async function listMyEvents(db: Database, userId: string) {
  const orgRows = await db
    .select({ eventId: eventOrganizers.eventId })
    .from(eventOrganizers)
    .where(eq(eventOrganizers.userId, userId));
  const orgEventIds = orgRows.map((r) => r.eventId);

  const conditions = [
    eq(events.creatorId, userId),
    eq(events.facultyCoordinatorId, userId),
  ];
  if (orgEventIds.length > 0) {
    conditions.push(inArray(events.id, orgEventIds));
  }

  const rows = await db
    .select(eventSelection)
    .from(events)
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .leftJoin(users, eq(users.id, events.facultyCoordinatorId))
    .where(or(...conditions))
    .orderBy(desc(events.createdAt))
    .limit(100);

  const requests = await loadRequests(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toEventView(row, requests.get(row.id) ?? []));
}

export interface Viewer {
  userId: string;
  isAdmin: boolean;
}

export async function findEventRow(db: DbExecutor, eventId: string, lock = false) {
  const query = db
    .select(eventSelection)
    .from(events)
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .leftJoin(users, eq(users.id, events.facultyCoordinatorId))
    .where(eq(events.id, eventId));
  const [row] = lock ? await query.for('update', { of: events }) : await query.limit(1);
  if (!row) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found.');
  return row;
}

export async function assertEventViewAccess(db: DbExecutor, row: EventRow, viewer: Viewer) {
  if (viewer.isAdmin) return;
  if (row.creatorId === viewer.userId) return;
  if (row.facultyCoordinatorId === viewer.userId) return;
  if (await isEventCollaborator(db, row.id, viewer.userId)) return;
  throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found.');
}

export function assertEventManageAccess(row: EventRow, viewer: Viewer) {
  if (viewer.isAdmin) return;
  if (row.creatorId === viewer.userId) return;
  if (row.facultyCoordinatorId === viewer.userId) return;
  throw new AppError(
    403,
    'EVENT_FORBIDDEN',
    'Only the event creator, designated faculty coordinator, or administrator can manage this event.',
  );
}

export async function getEventView(db: Database, eventId: string, viewer: Viewer) {
  const row = await findEventRow(db, eventId);
  await assertEventViewAccess(db, row, viewer);
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

const activeFaculty = and(eq(users.status, 'ACTIVE'), inArray(roles.name, ['FACULTY', 'HOD']));

export function listFacultyCandidates(db: Database) {
  return db
    .selectDistinct({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      departmentName: departments.name,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(activeFaculty)
    .orderBy(users.firstName, users.lastName, departments.name, users.id);
}

async function validateFacultyCoordinator(db: DbExecutor, coordinatorId: string) {
  const [candidate] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.id, coordinatorId), activeFaculty))
    .limit(1);

  if (!candidate) {
    throw new AppError(
      400,
      'INVALID_FACULTY_COORDINATOR',
      'The designated coordinator must be an active faculty member or head of department.',
    );
  }
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

  if (input.facultyCoordinatorId) {
    await validateFacultyCoordinator(db, input.facultyCoordinatorId);
  }

  const eventId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(events)
      .values({
        title: input.title,
        description: input.description || null,
        expectedAttendance: input.expectedAttendance,
        departmentId,
        creatorId: viewer.userId,
        facultyCoordinatorId: input.facultyCoordinatorId || null,
      })
      .returning({ id: events.id });
    if (!created) throw new Error('Event insert returned no row.');

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'EVENT_CREATED',
      entityName: 'events',
      entityId: created.id,
      newState: {
        title: input.title,
        expectedAttendance: input.expectedAttendance,
        facultyCoordinatorId: input.facultyCoordinatorId || null,
      },
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
    assertEventManageAccess(row, viewer);
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

    if (input.facultyCoordinatorId !== undefined && input.facultyCoordinatorId !== null) {
      await validateFacultyCoordinator(tx, input.facultyCoordinatorId);
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
        ...(input.facultyCoordinatorId !== undefined
          ? { facultyCoordinatorId: input.facultyCoordinatorId }
          : {}),
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
        facultyCoordinatorId: row.facultyCoordinatorId,
      },
      newState: input as Record<string, unknown>,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return getEventView(db, eventId, viewer);
}

export async function getEventTeam(
  db: Database,
  eventId: string,
  viewer: Viewer,
): Promise<EventTeamView> {
  const row = await findEventRow(db, eventId);
  await assertEventViewAccess(db, row, viewer);

  // Load creator
  const [creatorUser] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      departmentId: departments.id,
      departmentCode: departments.code,
      departmentName: departments.name,
    })
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(users.id, row.creatorId))
    .limit(1);

  const creator: EventTeamMember = {
    id: creatorUser!.id,
    userId: creatorUser!.id,
    firstName: creatorUser!.firstName,
    lastName: creatorUser!.lastName,
    email: creatorUser!.email,
    department: {
      id: creatorUser!.departmentId,
      code: creatorUser!.departmentCode,
      name: creatorUser!.departmentName,
    },
  };

  let facultyCoordinator: EventTeamMember | null = null;
  if (row.facultyCoordinatorId) {
    const [coordUser] = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        departmentId: departments.id,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(users)
      .innerJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(users.id, row.facultyCoordinatorId))
      .limit(1);

    if (coordUser) {
      facultyCoordinator = {
        id: coordUser.id,
        userId: coordUser.id,
        firstName: coordUser.firstName,
        lastName: coordUser.lastName,
        email: coordUser.email,
        department: {
          id: coordUser.departmentId,
          code: coordUser.departmentCode,
          name: coordUser.departmentName,
        },
      };
    }
  }

  // Load organizers
  const organizerRows = await db
    .select({
      id: eventOrganizers.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      assignedAt: eventOrganizers.createdAt,
      departmentId: departments.id,
      departmentCode: departments.code,
      departmentName: departments.name,
      assignedById: eventOrganizers.assignedById,
    })
    .from(eventOrganizers)
    .innerJoin(users, eq(users.id, eventOrganizers.userId))
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(eventOrganizers.eventId, eventId))
    .orderBy(desc(eventOrganizers.createdAt));

  const organizers: EventTeamMember[] = organizerRows.map((org) => ({
    id: org.id,
    userId: org.userId,
    firstName: org.firstName,
    lastName: org.lastName,
    email: org.email,
    department: {
      id: org.departmentId,
      code: org.departmentCode,
      name: org.departmentName,
    },
    assignedAt: org.assignedAt.toISOString(),
  }));

  return { creator, facultyCoordinator, organizers };
}

export async function listOrganizerCandidates(
  db: Database,
  eventId: string,
  viewer: Viewer,
  search: string | undefined,
) {
  const row = await findEventRow(db, eventId);
  assertEventManageAccess(row, viewer);

  const term = search?.trim();
  const conditions = [eq(users.status, 'ACTIVE')];
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(
        ilike(users.email, pattern),
        ilike(users.firstName, pattern),
        ilike(users.lastName, pattern),
      )!,
    );
  }

  const rows = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      departmentId: departments.id,
      departmentCode: departments.code,
      departmentName: departments.name,
    })
    .from(users)
    .innerJoin(departments, eq(departments.id, users.departmentId))
    .where(and(...conditions))
    .orderBy(users.firstName, users.lastName)
    .limit(10);

  return rows.map((candidate) => ({
    userId: candidate.userId,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
    department: {
      id: candidate.departmentId,
      code: candidate.departmentCode,
      name: candidate.departmentName,
    },
  }));
}

export async function setEventCoordinator(
  db: Database,
  eventId: string,
  viewer: Viewer,
  input: EventCoordinatorInput,
  context: { ipAddress?: string; userAgent?: string },
) {
  const row = await findEventRow(db, eventId);
  assertEventManageAccess(row, viewer);

  await validateFacultyCoordinator(db, input.facultyCoordinatorId);

  await db.transaction(async (tx) => {
    await tx
      .update(events)
      .set({
        facultyCoordinatorId: input.facultyCoordinatorId,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId));

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'EVENT_COORDINATOR_UPDATED',
      entityName: 'events',
      entityId: eventId,
      oldState: { facultyCoordinatorId: row.facultyCoordinatorId },
      newState: { facultyCoordinatorId: input.facultyCoordinatorId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return getEventTeam(db, eventId, viewer);
}

export async function addEventOrganizer(
  db: Database,
  eventId: string,
  viewer: Viewer,
  input: EventOrganizerInput,
  context: { ipAddress?: string; userAgent?: string },
) {
  const row = await findEventRow(db, eventId);
  assertEventManageAccess(row, viewer);

  if (input.userId === row.creatorId) {
    throw new AppError(400, 'CREATOR_CANNOT_BE_ORGANIZER', 'The event creator is already the primary organizer.');
  }

  const [targetUser] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!targetUser || targetUser.status !== 'ACTIVE') {
    throw new AppError(400, 'USER_NOT_ELIGIBLE', 'The selected user is not active.');
  }

  await db.transaction(async (tx) => {
    const [organizer] = await tx.insert(eventOrganizers).values({
      eventId,
      userId: input.userId,
      assignedById: viewer.userId,
    }).onConflictDoNothing({ target: [eventOrganizers.eventId, eventOrganizers.userId] })
      .returning({ id: eventOrganizers.id });
    if (!organizer) {
      throw new AppError(409, 'ORGANIZER_ALREADY_EXISTS', 'This user is already an organizer for this event.');
    }

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'EVENT_ORGANIZER_ADDED',
      entityName: 'event_organizers',
      entityId: eventId,
      newState: { userId: input.userId, assignedById: viewer.userId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return getEventTeam(db, eventId, viewer);
}

export async function removeEventOrganizer(
  db: Database,
  eventId: string,
  viewer: Viewer,
  targetUserId: string,
  context: { ipAddress?: string; userAgent?: string },
) {
  const row = await findEventRow(db, eventId);
  // An organizer can remove themselves, or an authorized manager (creator/coordinator/admin) can remove them
  if (viewer.userId !== targetUserId) {
    assertEventManageAccess(row, viewer);
  }

  const [existing] = await db
    .select({ id: eventOrganizers.id })
    .from(eventOrganizers)
    .where(and(eq(eventOrganizers.eventId, eventId), eq(eventOrganizers.userId, targetUserId)))
    .limit(1);

  if (!existing) {
    throw new AppError(404, 'ORGANIZER_NOT_FOUND', 'This user is not an organizer of this event.');
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(eventOrganizers)
      .where(and(eq(eventOrganizers.eventId, eventId), eq(eventOrganizers.userId, targetUserId)));

    await writeAudit(tx, {
      actorId: viewer.userId,
      action: 'EVENT_ORGANIZER_REMOVED',
      entityName: 'event_organizers',
      entityId: eventId,
      oldState: { userId: targetUserId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  return getEventTeam(db, eventId, viewer);
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
    assertEventManageAccess(row, viewer);
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
