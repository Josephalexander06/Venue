import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';
import type { Database } from '../src/db/index.js';
import {
  approvalInstances,
  approvalWorkflows,
  auditLogs,
  departments,
  events,
  venueAllotments,
  venueRequests,
  venues,
  workflowSteps,
} from '../src/db/schema.js';
import {
  createTestUser,
  getTestDatabase,
  login,
  mutationHeaders,
  resetDatabase,
  type TestSession,
} from './helpers.js';

let app: FastifyInstance;
let db: Database;

beforeAll(async () => {
  db = getTestDatabase();
  app = await buildApp({ db, env: parseEnv(process.env), logger: false });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  const [workflow] = await db
    .insert(approvalWorkflows)
    .values({ name: `Default ${randomUUID()}`, isDefault: true })
    .returning();
  await db.insert(workflowSteps).values({
    workflowId: workflow!.id,
    stepOrder: 1,
    stepName: 'Department endorsement',
    requiredRole: 'HOD',
    scopeType: 'CREATOR_DEPARTMENT',
  });
});

async function departmentId(code: string) {
  const [row] = await db.select({ id: departments.id }).from(departments).where(eq(departments.code, code));
  if (!row) throw new Error(`Missing department ${code}`);
  return row.id;
}

async function createVenue(overrides: Partial<typeof venues.$inferInsert> = {}) {
  const [venue] = await db
    .insert(venues)
    .values({
      code: `HALL-${randomUUID().slice(0, 8)}`,
      name: 'Seminar Hall',
      building: 'Academic Block',
      floor: 2,
      capacity: 100,
      facilities: ['Projector', 'Air conditioning'],
      setupBufferMins: 30,
      teardownBufferMins: 30,
      departmentId: await departmentId('CS'),
      ...overrides,
    })
    .returning();
  return venue!;
}

async function studentSession(departmentCode = 'CS') {
  const { user, password } = await createTestUser({
    email: `student-${randomUUID()}@college.edu`,
    role: 'FACULTY',
    departmentCode,
  });
  return login(app, user.email, password);
}

async function adminSession() {
  const { user, password } = await createTestUser({
    email: `admin-${randomUUID()}@college.edu`,
    role: 'ADMINISTRATOR',
    departmentCode: 'ADMIN',
  });
  return login(app, user.email, password);
}

async function createEvent(session: TestSession, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/events',
    headers: mutationHeaders(session),
    payload: {
      title: 'Annual Robotics Showcase',
      description: 'A student-led showcase.',
      expectedAttendance: 40,
      ...overrides,
    },
  });
  return response;
}

async function requestBooking(
  session: TestSession,
  eventId: string,
  venueId: string,
  startTime: string,
  endTime: string,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/venue-requests',
    headers: mutationHeaders(session),
    payload: { eventId, venueId, startTime, endTime },
  });
}

async function confirmedRequestFor(
  session: TestSession,
  venueId: string,
  startTime: string,
  endTime: string,
) {
  const event = await createEvent(session);
  const request = await requestBooking(
    session,
    event.json().event.id,
    venueId,
    startTime,
    endTime,
  );
  const requestId = request.json().request.id as string;
  const [venueRow] = await db
    .select({ setupBufferMins: venues.setupBufferMins, teardownBufferMins: venues.teardownBufferMins })
    .from(venues)
    .where(eq(venues.id, venueId));
  const reservedStart = new Date(
    new Date(startTime).getTime() - (venueRow?.setupBufferMins ?? 0) * 60_000,
  ).toISOString();
  const reservedEnd = new Date(
    new Date(endTime).getTime() + (venueRow?.teardownBufferMins ?? 0) * 60_000,
  ).toISOString();
  const [allotment] = await db
    .insert(venueAllotments)
    .values({
      venueRequestId: requestId,
      venueId,
      eventId: event.json().event.id,
      reservedRange: `[${reservedStart},${reservedEnd})`,
      allottedBy: (await adminSession()).user.id as string,
    })
    .returning();
  await db.update(venueRequests).set({ status: 'CONFIRMED' }).where(eq(venueRequests.id, requestId));
  return { requestId, eventId: event.json().event.id as string, allotment: allotment! };
}

describe('venue management', () => {
  it('restricts venue changes to administrators and supports create, filter, archive and restore', async () => {
    const admin = await adminSession();
    const student = await studentSession();
    const building = `Block ${randomUUID().slice(0, 6)}`;

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/venues',
      headers: mutationHeaders(student),
      payload: {
        code: 'NOPE',
        name: 'Forbidden Hall',
        building,
        floor: 1,
        capacity: 20,
        facilities: [],
        setupBufferMins: 0,
        teardownBufferMins: 0,
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/venues',
      headers: mutationHeaders(admin),
      payload: {
        code: 'filter-hall',
        name: 'Filter Hall',
        building,
        floor: 1,
        capacity: 42,
        facilities: ['Projector', 'Stage', 'Projector'],
        setupBufferMins: 15,
        teardownBufferMins: 20,
        departmentId: await departmentId('CS'),
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().venue).toMatchObject({
      code: 'FILTER-HALL',
      capacity: 42,
      facilities: ['Projector', 'Stage'],
      setupBufferMins: 15,
      teardownBufferMins: 20,
    });

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/v1/venues?search=Filter&building=${encodeURIComponent(building)}&minCapacity=40`,
      headers: { cookie: student.cookie },
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().total).toBe(1);
    expect(filtered.json().venues[0].name).toBe('Filter Hall');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/venues',
      headers: mutationHeaders(admin),
      payload: {
        code: 'FILTER-HALL',
        name: 'Duplicate Hall',
        building,
        floor: 1,
        capacity: 30,
        facilities: [],
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/venues/${created.json().venue.id}`,
      headers: mutationHeaders(admin),
      payload: { capacity: 55, isActive: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().venue).toMatchObject({ capacity: 55, isActive: false });

    const publicList = await app.inject({
      method: 'GET',
      url: '/api/v1/venues?search=Filter',
      headers: { cookie: student.cookie },
    });
    expect(publicList.json().total).toBe(0);

    const adminList = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/venues?search=Filter&active=false',
      headers: { cookie: admin.cookie },
    });
    expect(adminList.json().total).toBe(1);

    const restored = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/venues/${created.json().venue.id}`,
      headers: mutationHeaders(admin),
      payload: { isActive: true },
    });
    expect(restored.json().venue.isActive).toBe(true);

    const archived = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/venues/${created.json().venue.id}`,
      headers: mutationHeaders(admin),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().venue.isActive).toBe(false);
  });

  it('rejects invalid venue data and paginates the catalogue', async () => {
    const admin = await adminSession();
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/venues',
      headers: mutationHeaders(admin),
      payload: { code: 'bad code!', name: 'X', building: '', floor: 1, capacity: 0 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe('VALIDATION_ERROR');

    await createVenue({ name: 'Alpha Hall' });
    await createVenue({ name: 'Beta Hall' });
    const page = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/venues?limit=1&offset=1',
      headers: { cookie: admin.cookie },
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().total).toBe(2);
    expect(page.json().venues).toHaveLength(1);
  });
});

describe('events and request authorization', () => {
  it('keeps events owned by their creator and scopes department on create', async () => {
    const student = await studentSession();
    const other = await studentSession('ME');
    const event = await createEvent(student);
    expect(event.statusCode).toBe(201);
    const eventId = event.json().event.id as string;

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/events/mine',
      headers: { cookie: student.cookie },
    });
    expect(mine.json().events).toHaveLength(1);

    const otherList = await app.inject({
      method: 'GET',
      url: '/api/v1/events/mine',
      headers: { cookie: other.cookie },
    });
    expect(otherList.json().events).toHaveLength(0);

    const steal = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: mutationHeaders(other),
      payload: { title: 'Hijacked event' },
    });
    expect(steal.statusCode).toBe(403);

    const crossDepartment = await createEvent(student, {
      departmentId: await departmentId('ME'),
    });
    expect(crossDepartment.statusCode).toBe(403);
    expect(crossDepartment.json().code).toBe('DEPARTMENT_FORBIDDEN');
  });

  it('updates event details and enforces booked-venue capacity', async () => {
    const student = await studentSession();
    const venue = await createVenue({ capacity: 80 });
    const event = await createEvent(student);
    const eventId = event.json().event.id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: mutationHeaders(student),
      payload: { title: 'Renamed showcase' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().event.title).toBe('Renamed showcase');

    const requested = await requestBooking(
      student,
      eventId,
      venue.id,
      '2099-03-15T10:00:00Z',
      '2099-03-15T12:00:00Z',
    );
    expect(requested.statusCode).toBe(201);

    const tooLarge = await app.inject({
      method: 'PATCH',
      url: `/api/v1/events/${eventId}`,
      headers: mutationHeaders(student),
      payload: { expectedAttendance: 200 },
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().code).toBe('CAPACITY_EXCEEDED');
  });

  it('cancels a whole event including its confirmed allotment', async () => {
    const student = await studentSession();
    const venue = await createVenue();
    const confirmed = await confirmedRequestFor(
      student,
      venue.id,
      '2099-03-20T10:00:00Z',
      '2099-03-20T12:00:00Z',
    );

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${confirmed.eventId}`,
      headers: mutationHeaders(student),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().event.status).toBe('CANCELLED');
    expect(response.json().event.requests[0].status).toBe('CANCELLED');

    const [allotment] = await db
      .select({ status: venueAllotments.status })
      .from(venueAllotments)
      .where(eq(venueAllotments.venueRequestId, confirmed.requestId));
    expect(allotment?.status).toBe('CANCELLED');
  });

  it('prevents IDOR on request details and request edits', async () => {
    const owner = await studentSession();
    const other = await studentSession('ME');
    const venue = await createVenue();
    const event = await createEvent(owner);
    const created = await requestBooking(
      owner,
      event.json().event.id,
      venue.id,
      '2099-03-10T10:00:00Z',
      '2099-03-10T12:00:00Z',
    );
    expect(created.statusCode).toBe(201);
    const requestId = created.json().request.id as string;

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/venue-requests/${requestId}`,
      headers: { cookie: other.cookie },
    });
    expect(read.statusCode).toBe(404);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/venue-requests/${requestId}`,
      headers: mutationHeaders(other),
      payload: { startTime: '2099-03-10T13:00:00Z', endTime: '2099-03-10T14:00:00Z' },
    });
    expect(edit.statusCode).toBe(404);
  });
});

describe('request conflicts and buffers', () => {
  it('allows overlapping pending requests and reports them before submission', async () => {
    const student = await studentSession();
    const venue = await createVenue();
    const firstEvent = await createEvent(student, { title: 'First event' });
    const secondEvent = await createEvent(student, { title: 'Second event' });

    const first = await requestBooking(
      student,
      firstEvent.json().event.id,
      venue.id,
      '2099-04-02T10:00:00Z',
      '2099-04-02T12:00:00Z',
    );
    const second = await requestBooking(
      student,
      secondEvent.json().event.id,
      venue.id,
      '2099-04-02T11:00:00Z',
      '2099-04-02T13:00:00Z',
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const availability = await app.inject({
      method: 'GET',
      url: `/api/v1/venues/${venue.id}/availability?from=2099-04-02T10%3A30%3A00Z&to=2099-04-02T11%3A30%3A00Z`,
      headers: { cookie: student.cookie },
    });
    expect(availability.statusCode).toBe(200);
    expect(availability.json().hasConfirmedConflict).toBe(false);
    expect(availability.json().pendingConflicts).toHaveLength(2);
    expect(availability.json().effectiveRange).toEqual({
      start: '2099-04-02T10:00:00.000Z',
      end: '2099-04-02T12:00:00.000Z',
    });

    const calendar = await app.inject({
      method: 'GET',
      url: `/api/v1/venues/${venue.id}/calendar?from=2099-04-02T00%3A00%3A00Z&to=2099-04-03T00%3A00%3A00Z`,
      headers: { cookie: student.cookie },
    });
    expect(calendar.json().entries).toHaveLength(2);
    expect(calendar.json().entries.every((entry: { kind: string }) => entry.kind === 'PENDING')).toBe(
      true,
    );
  });

  it('blocks requests against a confirmed booking and respects buffer edges', async () => {
    const student = await studentSession();
    const venue = await createVenue({ setupBufferMins: 30, teardownBufferMins: 30 });
    await confirmedRequestFor(
      student,
      venue.id,
      '2099-05-01T10:00:00Z',
      '2099-05-01T12:00:00Z',
    );

    const event = await createEvent(student);
    const blocked = await requestBooking(
      student,
      event.json().event.id,
      venue.id,
      '2099-05-01T12:15:00Z',
      '2099-05-01T13:30:00Z',
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SLOT_ALREADY_CONFIRMED');

    const adjacentEvent = await createEvent(student);
    const adjacent = await requestBooking(
      student,
      adjacentEvent.json().event.id,
      venue.id,
      '2099-05-01T13:00:00Z',
      '2099-05-01T14:00:00Z',
    );
    expect(adjacent.statusCode).toBe(201);

    const availability = await app.inject({
      method: 'GET',
      url: `/api/v1/venues/${venue.id}/availability?from=2099-05-01T12%3A45%3A00Z&to=2099-05-01T13%3A00%3A00Z`,
      headers: { cookie: student.cookie },
    });
    expect(availability.json().hasConfirmedConflict).toBe(true);
    expect(availability.json().confirmedConflicts[0].requestId).toBeTruthy();
  });

  it('excludes the request being edited from its own conflict check', async () => {
    const student = await studentSession();
    const venue = await createVenue();
    const event = await createEvent(student);
    const created = await requestBooking(
      student,
      event.json().event.id,
      venue.id,
      '2099-05-10T10:00:00Z',
      '2099-05-10T12:00:00Z',
    );
    const requestId = created.json().request.id as string;
    const availability = await app.inject({
      method: 'GET',
      url: `/api/v1/venues/${venue.id}/availability?from=2099-05-10T10%3A00%3A00Z&to=2099-05-10T12%3A00%3A00Z&excludeRequestId=${requestId}`,
      headers: { cookie: student.cookie },
    });
    expect(availability.json().pendingConflicts).toHaveLength(0);
  });

  it('validates intervals, timezone offsets, capacity and venue availability', async () => {
    const student = await studentSession();
    const venue = await createVenue({ capacity: 50 });

    const reversedEvent = await createEvent(student);
    const reversed = await requestBooking(
      student,
      reversedEvent.json().event.id,
      venue.id,
      '2099-06-01T12:00:00Z',
      '2099-06-01T10:00:00Z',
    );
    expect(reversed.statusCode).toBe(400);
    expect(reversed.json().code).toBe('INVALID_INTERVAL');

    const noOffsetEvent = await createEvent(student);
    const noOffset = await requestBooking(
      student,
      noOffsetEvent.json().event.id,
      venue.id,
      '2099-06-01T10:00:00',
      '2099-06-01T12:00:00',
    );
    expect(noOffset.statusCode).toBe(400);
    expect(noOffset.json().code).toBe('VALIDATION_ERROR');

    const pastEvent = await createEvent(student);
    const past = await requestBooking(
      student,
      pastEvent.json().event.id,
      venue.id,
      '2020-01-01T10:00:00Z',
      '2020-01-01T12:00:00Z',
    );
    expect(past.statusCode).toBe(400);
    expect(past.json().code).toBe('START_IN_PAST');

    const bigEvent = await createEvent(student, { expectedAttendance: 500 });
    const overCapacity = await requestBooking(
      student,
      bigEvent.json().event.id,
      venue.id,
      '2099-06-02T10:00:00Z',
      '2099-06-02T12:00:00Z',
    );
    expect(overCapacity.statusCode).toBe(400);
    expect(overCapacity.json().code).toBe('CAPACITY_EXCEEDED');

    await db.update(venues).set({ isActive: false }).where(eq(venues.id, venue.id));
    const inactiveEvent = await createEvent(student);
    const inactive = await requestBooking(
      student,
      inactiveEvent.json().event.id,
      venue.id,
      '2099-06-03T10:00:00Z',
      '2099-06-03T12:00:00Z',
    );
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json().code).toBe('VENUE_UNAVAILABLE');

    const offsetEvent = await createEvent(student);
    const offsetVenue = await createVenue({ isActive: true });
    const offset = await requestBooking(
      student,
      offsetEvent.json().event.id,
      offsetVenue.id,
      '2099-06-04T10:00:00+05:30',
      '2099-06-04T12:00:00+05:30',
    );
    expect(offset.statusCode).toBe(201);
    expect(offset.json().request.startTime).toBe('2099-06-04T04:30:00.000Z');
    expect(offset.json().request.endTime).toBe('2099-06-04T06:30:00.000Z');
  });
});

describe('request lifecycle', () => {
  it('resets approvals only when a critical field changes', async () => {
    const student = await studentSession();
    const venue = await createVenue();
    const event = await createEvent(student);
    const created = await requestBooking(
      student,
      event.json().event.id,
      venue.id,
      '2099-07-01T10:00:00Z',
      '2099-07-01T12:00:00Z',
    );
    const requestId = created.json().request.id as string;
    await db
      .update(venueRequests)
      .set({ status: 'IN_REVIEW', currentStepOrder: 1 })
      .where(eq(venueRequests.id, requestId));
    await db
      .update(approvalInstances)
      .set({ currentStepOrder: 1 })
      .where(eq(approvalInstances.venueRequestId, requestId));

    const nonCritical = await app.inject({
      method: 'PATCH',
      url: `/api/v1/venue-requests/${requestId}`,
      headers: mutationHeaders(student),
      payload: { event: { title: 'Clarified event title' } },
    });
    expect(nonCritical.statusCode).toBe(200);
    expect(nonCritical.json().request.status).toBe('IN_REVIEW');
    const activeBefore = await db
      .select({ id: approvalInstances.id, isActive: approvalInstances.isActive })
      .from(approvalInstances)
      .where(eq(approvalInstances.venueRequestId, requestId));
    expect(activeBefore).toHaveLength(1);
    expect(activeBefore[0]!.isActive).toBe(true);

    const critical = await app.inject({
      method: 'PATCH',
      url: `/api/v1/venue-requests/${requestId}`,
      headers: mutationHeaders(student),
      payload: {
        startTime: '2099-07-02T10:00:00Z',
        endTime: '2099-07-02T12:00:00Z',
        event: { title: 'Clarified event title' },
      },
    });
    expect(critical.statusCode).toBe(200);
    expect(critical.json().request.status).toBe('SUBMITTED');
    expect(critical.json().request.currentStepOrder).toBe(1);

    const instances = await db
      .select({ id: approvalInstances.id, isActive: approvalInstances.isActive })
      .from(approvalInstances)
      .where(eq(approvalInstances.venueRequestId, requestId))
      .orderBy(approvalInstances.createdAt);
    expect(instances).toHaveLength(2);
    expect(instances[0]!.isActive).toBe(false);
    expect(instances[1]!.isActive).toBe(true);

    const audit = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityName, 'venue_requests'),
          eq(auditLogs.entityId, requestId),
          eq(auditLogs.action, 'VENUE_REQUEST_RESUBMITTED'),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it('cancels a request, releases its allotment and cancels the event', async () => {
    const student = await studentSession();
    const venue = await createVenue();
    const confirmed = await confirmedRequestFor(
      student,
      venue.id,
      '2099-08-10T10:00:00Z',
      '2099-08-10T12:00:00Z',
    );

    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/api/v1/venue-requests/${confirmed.requestId}`,
      headers: mutationHeaders(student),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().request.status).toBe('CANCELLED');

    const [allotment] = await db
      .select({ status: venueAllotments.status })
      .from(venueAllotments)
      .where(eq(venueAllotments.venueRequestId, confirmed.requestId));
    expect(allotment?.status).toBe('CANCELLED');

    const [eventRow] = await db
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, confirmed.eventId));
    expect(eventRow?.status).toBe('CANCELLED');

    const replacementEvent = await createEvent(student);
    const replacement = await requestBooking(
      student,
      replacementEvent.json().event.id,
      venue.id,
      '2099-08-10T10:00:00Z',
      '2099-08-10T12:00:00Z',
    );
    expect(replacement.statusCode).toBe(201);
  });

  it('rejects critical edits to a confirmed booking', async () => {
    const student = await studentSession();
    const venue = await createVenue();
    const confirmed = await confirmedRequestFor(
      student,
      venue.id,
      '2099-09-01T10:00:00Z',
      '2099-09-01T12:00:00Z',
    );
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/venue-requests/${confirmed.requestId}`,
      headers: mutationHeaders(student),
      payload: { startTime: '2099-09-02T10:00:00Z', endTime: '2099-09-02T12:00:00Z' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFIRMED_REQUEST_LOCKED');
  });

  it('allows rescheduling when prior requests are rejected or superseded, but blocks duplicate active requests', async () => {
    const student = await studentSession();
    const venue = await createVenue();
    const eventRes = await createEvent(student, { title: 'Reschedule Test Event' });
    const eventId = eventRes.json().event.id;

    // 1. Submit initial request
    const firstReq = await requestBooking(
      student,
      eventId,
      venue.id,
      '2099-10-01T10:00:00Z',
      '2099-10-01T12:00:00Z',
    );
    expect(firstReq.statusCode).toBe(201);
    const firstReqId = firstReq.json().request.id;

    // 2. Attempting a second active request while first is SUBMITTED fails with 409
    const dupReq = await requestBooking(
      student,
      eventId,
      venue.id,
      '2099-10-02T10:00:00Z',
      '2099-10-02T12:00:00Z',
    );
    expect(dupReq.statusCode).toBe(409);
    expect(dupReq.json().code).toBe('EVENT_ALREADY_SUBMITTED');

    // 3. Reject first request
    await db
      .update(venueRequests)
      .set({ status: 'REJECTED', rejectionReason: 'Slot not available' })
      .where(eq(venueRequests.id, firstReqId));

    // 4. Now submitting a new venue request for the event succeeds (rescheduled!)
    const rescheduledReq = await requestBooking(
      student,
      eventId,
      venue.id,
      '2099-10-03T10:00:00Z',
      '2099-10-03T12:00:00Z',
    );
    expect(rescheduledReq.statusCode).toBe(201);
    expect(rescheduledReq.json().request.status).toBe('SUBMITTED');

    // 5. Duplicate check still guards against multiple active requests after reschedule
    const dupReqAfterReschedule = await requestBooking(
      student,
      eventId,
      venue.id,
      '2099-10-04T10:00:00Z',
      '2099-10-04T12:00:00Z',
    );
    expect(dupReqAfterReschedule.statusCode).toBe(409);
    expect(dupReqAfterReschedule.json().code).toBe('EVENT_ALREADY_SUBMITTED');
  });
});
