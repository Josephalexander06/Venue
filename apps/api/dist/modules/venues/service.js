import { and, asc, count, eq, gte, ilike, inArray, or, sql, } from 'drizzle-orm';
import { approvalWorkflows, departments, events, venueAllotments, venueRequests, venues, } from '../../db/schema.js';
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
function mapVenue(row) {
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
        department: row.departmentId && row.departmentCode && row.departmentName
            ? { id: row.departmentId, code: row.departmentCode, name: row.departmentName }
            : null,
        workflow: row.workflowId && row.workflowName
            ? { id: row.workflowId, name: row.workflowName }
            : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
export async function listVenues(db, filters) {
    const conditions = [];
    if (filters.active !== undefined)
        conditions.push(eq(venues.isActive, filters.active));
    if (filters.departmentId)
        conditions.push(eq(venues.departmentId, filters.departmentId));
    if (filters.minCapacity)
        conditions.push(gte(venues.capacity, filters.minCapacity));
    if (filters.building)
        conditions.push(ilike(venues.building, `%${filters.building}%`));
    if (filters.search) {
        const pattern = `%${filters.search}%`;
        const search = or(ilike(venues.name, pattern), ilike(venues.code, pattern), ilike(venues.building, pattern));
        if (search)
            conditions.push(search);
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
export async function getVenueView(db, venueId, options = {}) {
    const [row] = await db
        .select(venueSelection)
        .from(venues)
        .leftJoin(departments, eq(departments.id, venues.departmentId))
        .leftJoin(approvalWorkflows, eq(approvalWorkflows.id, venues.workflowId))
        .where(options.includeInactive
        ? eq(venues.id, venueId)
        : and(eq(venues.id, venueId), eq(venues.isActive, true)))
        .limit(1);
    return row ? mapVenue(row) : null;
}
export async function requireVenue(db, venueId, includeInactive = false) {
    const venue = await getVenueView(db, venueId, { includeInactive });
    if (!venue)
        throw new AppError(404, 'VENUE_NOT_FOUND', 'Venue not found.');
    return venue;
}
async function requireDepartment(db, departmentId) {
    if (!departmentId)
        return null;
    const [department] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, departmentId))
        .limit(1);
    if (!department)
        throw new AppError(400, 'DEPARTMENT_NOT_FOUND', 'Department not found.');
    return department.id;
}
export async function createVenue(db, input) {
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
    if (!created)
        throw new Error('Venue insert returned no row.');
    return requireVenue(db, created.id, true);
}
export async function updateVenue(db, venueId, input) {
    await requireVenue(db, venueId, true);
    const values = {};
    if (input.code !== undefined)
        values.code = input.code;
    if (input.name !== undefined)
        values.name = input.name;
    if (input.building !== undefined)
        values.building = input.building;
    if (input.floor !== undefined)
        values.floor = input.floor;
    if (input.capacity !== undefined)
        values.capacity = input.capacity;
    if (input.facilities !== undefined)
        values.facilities = input.facilities;
    if (input.setupBufferMins !== undefined)
        values.setupBufferMins = input.setupBufferMins;
    if (input.teardownBufferMins !== undefined)
        values.teardownBufferMins = input.teardownBufferMins;
    if (input.isActive !== undefined)
        values.isActive = input.isActive;
    if (input.departmentId !== undefined)
        values.departmentId = await requireDepartment(db, input.departmentId);
    if (input.workflowId !== undefined)
        values.workflowId = await requireWorkflow(db, input.workflowId);
    await db.update(venues).set(values).where(eq(venues.id, venueId));
    return requireVenue(db, venueId, true);
}
export async function archiveVenue(db, venueId) {
    await requireVenue(db, venueId, true);
    await db.update(venues).set({ isActive: false }).where(eq(venues.id, venueId));
    return requireVenue(db, venueId, true);
}
function rangePredicate(column, from, to) {
    return sql `${column} && tstzrange(${from}, ${to}, '[)')`;
}
export async function getVenueCalendar(db, venueId, from, to, includeInactive = false) {
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
        .where(and(eq(venueAllotments.venueId, venueId), eq(venueAllotments.status, 'ACTIVE'), rangePredicate(venueAllotments.reservedRange, from, to)));
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
        .where(and(eq(venueRequests.venueId, venueId), inArray(venueRequests.status, ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT']), rangePredicate(venueRequests.effectiveRange, from, to)));
    const entries = [
        ...confirmed.map((row) => ({
            ...row,
            kind: 'CONFIRMED',
            status: 'CONFIRMED',
            startTime: row.startTime.toISOString(),
            endTime: row.endTime.toISOString(),
            rangeStart: new Date(row.startTime.getTime() - row.setupBufferMins * 60_000).toISOString(),
            rangeEnd: new Date(row.endTime.getTime() + row.teardownBufferMins * 60_000).toISOString(),
        })),
        ...pending.map((row) => ({
            ...row,
            kind: 'PENDING',
            status: row.status,
            startTime: row.startTime.toISOString(),
            endTime: row.endTime.toISOString(),
            rangeStart: new Date(row.startTime.getTime() - row.setupBufferMins * 60_000).toISOString(),
            rangeEnd: new Date(row.endTime.getTime() + row.teardownBufferMins * 60_000).toISOString(),
        })),
    ].sort((left, right) => left.startTime.localeCompare(right.startTime));
    return { venue, entries };
}
export async function checkAvailability(db, input) {
    const venue = await requireVenue(db, input.venueId);
    const effectiveStart = new Date(input.from.getTime() - venue.setupBufferMins * 60_000);
    const effectiveEnd = new Date(input.to.getTime() + venue.teardownBufferMins * 60_000);
    let excluded = null;
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
        status: sql `'CONFIRMED'`,
        startTime: venueRequests.startTime,
        endTime: venueRequests.endTime,
        setupBufferMins: venueRequests.setupBufferMins,
        teardownBufferMins: venueRequests.teardownBufferMins,
    })
        .from(venueAllotments)
        .innerJoin(venueRequests, eq(venueRequests.id, venueAllotments.venueRequestId))
        .innerJoin(events, eq(events.id, venueRequests.eventId))
        .where(and(eq(venueAllotments.venueId, input.venueId), eq(venueAllotments.status, 'ACTIVE'), rangePredicate(venueAllotments.reservedRange, effectiveStart, effectiveEnd)));
    const pendingConditions = [
        eq(venueRequests.venueId, input.venueId),
        inArray(venueRequests.status, ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT']),
        rangePredicate(venueRequests.effectiveRange, effectiveStart, effectiveEnd),
    ];
    if (excluded)
        pendingConditions.push(sql `${venueRequests.id} <> ${excluded}`);
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
    const mapConflict = (row) => ({
        requestId: row.requestId,
        eventId: row.eventId,
        title: row.title,
        status: row.status,
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
//# sourceMappingURL=service.js.map