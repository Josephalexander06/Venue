import {
  and,
  asc,
  count,
  eq,
  gte,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import type { VenueInput, VenueUpdateInput } from '@venue/shared';
import type { Database } from '../../db/index.js';
import {
  approvalWorkflows,
  departments,
  events,
  venueAllotments,
  venueRequests,
  venues,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { resolveWorkflowId, requireWorkflow } from '../workflows/service.js';

const venueSelection = {
  id: venues.id,
  code: venues.code,
  name: venues.name,
  building: venues.building,
  floor: venues.floor,
  capacity: venues.capacity,
  facilities: venues.facilities,
  setupBufferMins: venues.setupBufferMins,
  teardownBufferMins: venues.teardownBufferMins,
  isActive: venues.isActive,
  createdAt: venues.createdAt,
  updatedAt: venues.updatedAt,
  departmentId: departments.id,
  departmentCode: departments.code,
  departmentName: departments.name,
  workflowId: approvalWorkflows.id,
  workflowName: approvalWorkflows.name,
};

interface VenueRow {
  id: string;
  code: string;
  name: string;
  building: string;
  floor: number;
  capacity: number;
  facilities: string[];
  setupBufferMins: number;
  teardownBufferMins: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  departmentId: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  workflowId: string | null;
  workflowName: string | null;
}

export interface VenueView {
  id: string;
  code: string;
  name: string;
  building: string;
  floor: number;
  capacity: number;
  facilities: string[];
  setupBufferMins: number;
  teardownBufferMins: number;
  isActive: boolean;
  department: { id: string; code: string; name: string } | null;
  workflow: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

function mapVenue(row: VenueRow): VenueView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    building: row.building,
    floor: row.floor,
    capacity: row.capacity,
    facilities: row.facilities,
    setupBufferMins: row.setupBufferMins,
    teardownBufferMins: row.teardownBufferMins,
    isActive: row.isActive,
    department:
      row.departmentId && row.departmentCode && row.departmentName
        ? { id: row.departmentId, code: row.departmentCode, name: row.departmentName }
        : null,
    workflow:
      row.workflowId && row.workflowName
        ? { id: row.workflowId, name: row.workflowName }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface ListVenueFilters {
  search?: string;
  building?: string;
  facility?: string;
  availableDuring?: { from: Date; to: Date };
  departmentId?: string;
  minCapacity?: number;
  active?: boolean;
  limit: number;
  offset: number;
}

export async function listVenues(db: Database, filters: ListVenueFilters) {
  const conditions: SQL[] = [];
  if (filters.active !== undefined) conditions.push(eq(venues.isActive, filters.active));
  if (filters.departmentId) conditions.push(eq(venues.departmentId, filters.departmentId));
  if (filters.minCapacity) conditions.push(gte(venues.capacity, filters.minCapacity));
  if (filters.building) conditions.push(ilike(venues.building, `%${filters.building}%`));
  if (filters.facility) {
    conditions.push(sql`exists (
      select 1 from jsonb_array_elements_text(${venues.facilities}) as facility(name)
      where facility.name ilike ${`%${filters.facility}%`}
    )`);
  }
  if (filters.availableDuring) {
    const { from, to } = filters.availableDuring;
    conditions.push(sql`not exists (
      select 1 from ${venueAllotments}
      where ${venueAllotments.venueId} = ${venues.id}
        and ${venueAllotments.status} = 'ACTIVE'
        and ${venueAllotments.reservedRange} && tstzrange(
          ${from}::timestamptz - make_interval(mins => ${venues.setupBufferMins}),
          ${to}::timestamptz + make_interval(mins => ${venues.teardownBufferMins}), '[)'
        )
    )`);
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    const search = or(
      ilike(venues.name, pattern),
      ilike(venues.code, pattern),
      ilike(venues.building, pattern),
    );
    if (search) conditions.push(search);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select(venueSelection)
    .from(venues)
    .leftJoin(departments, eq(departments.id, venues.departmentId))
    .leftJoin(approvalWorkflows, eq(approvalWorkflows.id, venues.workflowId))
    .where(where)
    .orderBy(asc(venues.name))
    .limit(filters.limit)
    .offset(filters.offset);

  const [totalRow] = await db.select({ value: count() }).from(venues).where(where);
  return { venues: rows.map(mapVenue), total: totalRow?.value ?? 0 };
}

export async function getVenueView(
  db: Database,
  venueId: string,
  options: { includeInactive?: boolean } = {},
): Promise<VenueView | null> {
  const [row] = await db
    .select(venueSelection)
    .from(venues)
    .leftJoin(departments, eq(departments.id, venues.departmentId))
    .leftJoin(approvalWorkflows, eq(approvalWorkflows.id, venues.workflowId))
    .where(
      options.includeInactive
        ? eq(venues.id, venueId)
        : and(eq(venues.id, venueId), eq(venues.isActive, true)),
    )
    .limit(1);
  return row ? mapVenue(row) : null;
}

export async function requireVenue(db: Database, venueId: string, includeInactive = false) {
  const venue = await getVenueView(db, venueId, { includeInactive });
  if (!venue) throw new AppError(404, 'VENUE_NOT_FOUND', 'Venue not found.');
  return venue;
}

async function requireDepartment(db: Database, departmentId: string | null | undefined) {
  if (!departmentId) return null;
  const [department] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, departmentId))
    .limit(1);
  if (!department) throw new AppError(400, 'DEPARTMENT_NOT_FOUND', 'Department not found.');
  return department.id;
}

export async function createVenue(db: Database, input: VenueInput) {
  const departmentId = await requireDepartment(db, input.departmentId);
  const workflowId = await resolveWorkflowId(db, input.workflowId);
  const [created] = await db
    .insert(venues)
    .values({
      code: input.code,
      name: input.name,
      building: input.building,
      floor: input.floor,
      capacity: input.capacity,
      facilities: input.facilities,
      setupBufferMins: input.setupBufferMins,
      teardownBufferMins: input.teardownBufferMins,
      isActive: input.isActive,
      departmentId,
      workflowId,
    })
    .returning({ id: venues.id });
  if (!created) throw new Error('Venue insert returned no row.');
  return requireVenue(db, created.id, true);
}

export async function updateVenue(db: Database, venueId: string, input: VenueUpdateInput) {
  await requireVenue(db, venueId, true);
  const values: Partial<typeof venues.$inferInsert> = {};
  if (input.code !== undefined) values.code = input.code;
  if (input.name !== undefined) values.name = input.name;
  if (input.building !== undefined) values.building = input.building;
  if (input.floor !== undefined) values.floor = input.floor;
  if (input.capacity !== undefined) values.capacity = input.capacity;
  if (input.facilities !== undefined) values.facilities = input.facilities;
  if (input.setupBufferMins !== undefined) values.setupBufferMins = input.setupBufferMins;
  if (input.teardownBufferMins !== undefined) values.teardownBufferMins = input.teardownBufferMins;
  if (input.isActive !== undefined) values.isActive = input.isActive;
  if (input.departmentId !== undefined) values.departmentId = await requireDepartment(db, input.departmentId);
  if (input.workflowId !== undefined) values.workflowId = await requireWorkflow(db, input.workflowId);

  await db.update(venues).set(values).where(eq(venues.id, venueId));
  return requireVenue(db, venueId, true);
}

export async function archiveVenue(db: Database, venueId: string) {
  await requireVenue(db, venueId, true);
  await db.update(venues).set({ isActive: false }).where(eq(venues.id, venueId));
  return requireVenue(db, venueId, true);
}

/* ------------------------------------------------------------- calendar */

export interface CalendarEntry {
  id: string;
  kind: 'CONFIRMED' | 'PENDING';
  requestId: string;
  eventId: string;
  title: string;
  startTime: string;
  endTime: string;
  rangeStart: string;
  rangeEnd: string;
  status: 'CONFIRMED' | 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED_PENDING_ALLOTMENT';
  setupBufferMins: number;
  teardownBufferMins: number;
}

function rangePredicate(column: SQLWrapper, from: Date, to: Date) {
  return sql`${column} && tstzrange(${from}, ${to}, '[)')`;
}

export async function getVenueCalendar(
  db: Database,
  venueId: string,
  from: Date,
  to: Date,
  includeInactive = false,
) {
  const venue = await requireVenue(db, venueId, includeInactive);

  const confirmed = await db
    .select({
      id: venueAllotments.id,
      requestId: venueRequests.id,
      eventId: events.id,
      title: events.title,
      startTime: venueRequests.startTime,
      endTime: venueRequests.endTime,
      setupBufferMins: venueRequests.setupBufferMins,
      teardownBufferMins: venueRequests.teardownBufferMins,
    })
    .from(venueAllotments)
    .innerJoin(venueRequests, eq(venueRequests.id, venueAllotments.venueRequestId))
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .where(
      and(
        eq(venueAllotments.venueId, venueId),
        eq(venueAllotments.status, 'ACTIVE'),
        rangePredicate(venueAllotments.reservedRange, from, to),
      ),
    );

  const pending = await db
    .select({
      id: venueRequests.id,
      requestId: venueRequests.id,
      eventId: events.id,
      title: events.title,
      startTime: venueRequests.startTime,
      endTime: venueRequests.endTime,
      status: venueRequests.status,
      setupBufferMins: venueRequests.setupBufferMins,
      teardownBufferMins: venueRequests.teardownBufferMins,
    })
    .from(venueRequests)
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .where(
      and(
        eq(venueRequests.venueId, venueId),
        inArray(venueRequests.status, ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT']),
        rangePredicate(venueRequests.effectiveRange, from, to),
      ),
    );

  const entries: CalendarEntry[] = [
    ...confirmed.map((row) => ({
      ...row,
      kind: 'CONFIRMED' as const,
      status: 'CONFIRMED' as const,
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
      rangeStart: new Date(
        row.startTime.getTime() - row.setupBufferMins * 60_000,
      ).toISOString(),
      rangeEnd: new Date(
        row.endTime.getTime() + row.teardownBufferMins * 60_000,
      ).toISOString(),
    })),
    ...pending.map((row) => ({
      ...row,
      kind: 'PENDING' as const,
      status: row.status as CalendarEntry['status'],
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
      rangeStart: new Date(
        row.startTime.getTime() - row.setupBufferMins * 60_000,
      ).toISOString(),
      rangeEnd: new Date(
        row.endTime.getTime() + row.teardownBufferMins * 60_000,
      ).toISOString(),
    })),
  ].sort((left, right) => left.startTime.localeCompare(right.startTime));

  return { venue, entries };
}

/* --------------------------------------------------------- availability */

export interface ConflictView {
  requestId: string;
  eventId: string;
  title: string;
  status: CalendarEntry['status'];
  startTime: string;
  endTime: string;
  rangeStart: string;
  rangeEnd: string;
}

export async function checkAvailability(
  db: Database,
  input: {
    venueId: string;
    from: Date;
    to: Date;
    excludeRequestId?: string;
    viewerId: string;
    viewerIsAdmin: boolean;
  },
) {
  const venue = await requireVenue(db, input.venueId);
  const effectiveStart = new Date(input.from.getTime() - venue.setupBufferMins * 60_000);
  const effectiveEnd = new Date(input.to.getTime() + venue.teardownBufferMins * 60_000);

  let excluded: string | null = null;
  if (input.excludeRequestId) {
    const [owned] = await db
      .select({ id: venueRequests.id, creatorId: events.creatorId })
      .from(venueRequests)
      .innerJoin(events, eq(events.id, venueRequests.eventId))
      .where(eq(venueRequests.id, input.excludeRequestId))
      .limit(1);
    if (owned && (input.viewerIsAdmin || owned.creatorId === input.viewerId)) {
      excluded = owned.id;
    }
  }

  const confirmed = await db
    .select({
      id: venueAllotments.id,
      requestId: venueRequests.id,
      eventId: events.id,
      title: events.title,
      status: sql<string>`'CONFIRMED'`,
      startTime: venueRequests.startTime,
      endTime: venueRequests.endTime,
      setupBufferMins: venueRequests.setupBufferMins,
      teardownBufferMins: venueRequests.teardownBufferMins,
    })
    .from(venueAllotments)
    .innerJoin(venueRequests, eq(venueRequests.id, venueAllotments.venueRequestId))
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .where(
      and(
        eq(venueAllotments.venueId, input.venueId),
        eq(venueAllotments.status, 'ACTIVE'),
        rangePredicate(venueAllotments.reservedRange, effectiveStart, effectiveEnd),
      ),
    );

  const pendingConditions: SQL[] = [
    eq(venueRequests.venueId, input.venueId),
    inArray(venueRequests.status, ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT']),
    rangePredicate(venueRequests.effectiveRange, effectiveStart, effectiveEnd),
  ];
  if (excluded) pendingConditions.push(sql`${venueRequests.id} <> ${excluded}`);

  const pending = await db
    .select({
      id: venueRequests.id,
      requestId: venueRequests.id,
      eventId: events.id,
      title: events.title,
      status: venueRequests.status,
      startTime: venueRequests.startTime,
      endTime: venueRequests.endTime,
      setupBufferMins: venueRequests.setupBufferMins,
      teardownBufferMins: venueRequests.teardownBufferMins,
    })
    .from(venueRequests)
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .where(and(...pendingConditions));

  const mapConflict = (row: {
    requestId: string;
    eventId: string;
    title: string;
    status: string;
    startTime: Date;
    endTime: Date;
    setupBufferMins: number;
    teardownBufferMins: number;
  }): ConflictView => ({
    requestId: row.requestId,
    eventId: row.eventId,
    title: row.title,
    status: row.status as ConflictView['status'],
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    rangeStart: new Date(row.startTime.getTime() - row.setupBufferMins * 60_000).toISOString(),
    rangeEnd: new Date(row.endTime.getTime() + row.teardownBufferMins * 60_000).toISOString(),
  });

  return {
    venue,
    effectiveRange: {
      start: effectiveStart.toISOString(),
      end: effectiveEnd.toISOString(),
    },
    hasConfirmedConflict: confirmed.length > 0,
    confirmedConflicts: confirmed.map(mapConflict),
    pendingConflicts: pending.map(mapConflict),
  };
}
