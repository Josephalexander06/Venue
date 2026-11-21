import { randomUUID } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestDatabase, resetDatabase } from './helpers.js';
import {
  approvalWorkflows,
  auditLogs,
  departments,
  events,
  users,
  venueAllotments,
  venueRequests,
  venues,
} from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';
import { findPostgresError } from '../src/lib/postgres-error.js';

let db: Database;

beforeAll(() => {
  db = getTestDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  // The shared pool is closed by the global test setup.
});

async function fixture() {
  const reference = await resetDatabase();
  const [department] = await db.select().from(departments).where(sql`${departments.code} = 'CS'`);
  const [admin] = await db
    .insert(users)
    .values({
      email: `fixture-admin-${randomUUID()}@college.edu`,
      passwordHash: 'not-used-in-this-test',
      firstName: 'Fixture',
      lastName: 'Admin',
      departmentId: department!.id,
      status: 'ACTIVE',
    })
    .returning();
  const [venue] = await db
    .insert(venues)
    .values({
      code: `HALL-${randomUUID().slice(0, 8)}`,
      name: 'Main Auditorium',
      building: 'Central Block',
      capacity: 500,
      setupBufferMins: 30,
      teardownBufferMins: 30,
      departmentId: reference.departments.get('CS')!.id,
    })
    .returning();
  const [workflow] = await db
    .insert(approvalWorkflows)
    .values({ name: `Workflow ${randomUUID()}` })
    .returning();
  const [event] = await db
    .insert(events)
    .values({
      title: 'Annual Symposium',
      departmentId: reference.departments.get('CS')!.id,
      creatorId: admin!.id,
      expectedAttendance: 300,
    })
    .returning();

  return { admin: admin!, venue: venue!, workflow: workflow!, event: event!, reference };
}

async function createRequest(
  data: Awaited<ReturnType<typeof fixture>>,
  start: string,
  end: string,
  buffers = { setupBufferMins: 30, teardownBufferMins: 30 },
) {
  const [request] = await db
    .insert(venueRequests)
    .values({
      eventId: data.event.id,
      submittedById: data.admin.id,
      venueId: data.venue.id,
      workflowId: data.workflow.id,
      startTime: new Date(start),
      endTime: new Date(end),
      ...buffers,
    })
    .returning();
  return request!;
}

async function createAllotment(data: Awaited<ReturnType<typeof fixture>>, requestId: string) {
  const [allotment] = await db
    .insert(venueAllotments)
    .values({
      venueRequestId: requestId,
      venueId: data.venue.id,
      eventId: data.event.id,
      reservedRange: '[2000-01-01 00:00+00,2000-01-01 01:00+00)',
      allottedBy: data.admin.id,
    })
    .returning();
  return allotment!;
}

describe('venue reservation integrity', () => {
  it('uses timezone-aware TSTZRANGE columns and computes buffers correctly', async () => {
    const data = await fixture();
    const request = await createRequest(data, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z');

    const result = await db.execute<{ effective: string }>(sql`
      SELECT effective_range::text AS effective
      FROM venue_requests
      WHERE id = ${request.id}
    `);
    expect(result.rows[0]?.effective).toBe(
      '["2026-12-01 09:30:00+00","2026-12-01 12:30:00+00")',
    );

    const types = await db.execute<{ table_name: string; udt_name: string }>(sql`
      SELECT table_name, udt_name
      FROM information_schema.columns
      WHERE (table_name = 'venue_requests' AND column_name = 'effective_range')
         OR (table_name = 'venue_allotments' AND column_name = 'reserved_range')
      ORDER BY table_name
    `);
    expect(types.rows.map((row) => row.udt_name)).toEqual(['tstzrange', 'tstzrange']);
  });

  it('blocks overlapping active allotments including setup and teardown buffers', async () => {
    const data = await fixture();
    const morning = await createRequest(data, '2026-12-01T10:00:00Z', '2026-12-01T12:00:00Z');
    const overlapping = await createRequest(data, '2026-12-01T12:15:00Z', '2026-12-01T14:00:00Z');

    await createAllotment(data, morning.id);
    const conflict = await createAllotment(data, overlapping.id).catch((error: unknown) => error);
    expect(findPostgresError(conflict)?.code).toBe('23P01');

    const adjacent = await createRequest(
      data,
      '2026-12-01T12:30:00Z',
      '2026-12-01T14:00:00Z',
      { setupBufferMins: 0, teardownBufferMins: 0 },
    );
    await expect(createAllotment(data, adjacent.id)).resolves.toMatchObject({
      venueRequestId: adjacent.id,
    });
  });

  it('lets conflicting preliminary approvals race, then allows exactly one final allotment', async () => {
    const data = await fixture();
    const requests = await Promise.all([
      createRequest(data, '2026-12-02T10:00:00Z', '2026-12-02T14:00:00Z'),
      createRequest(data, '2026-12-02T11:00:00Z', '2026-12-02T15:00:00Z'),
      createRequest(data, '2026-12-02T09:00:00Z', '2026-12-02T13:00:00Z'),
      createRequest(data, '2026-12-02T13:00:00Z', '2026-12-02T17:00:00Z'),
      createRequest(data, '2026-12-02T10:30:00Z', '2026-12-02T12:30:00Z'),
    ]);

    await db
      .update(venueRequests)
      .set({ status: 'APPROVED_PENDING_ALLOTMENT' })
      .where(inArray(venueRequests.id, requests.map((request) => request.id)));
    const preliminary = await db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total
      FROM venue_requests
      WHERE status = 'APPROVED_PENDING_ALLOTMENT'
    `);
    expect(preliminary.rows[0]?.total).toBe(5);

    const results = await Promise.allSettled(requests.map((request) => createAllotment(data, request.id)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    // Simultaneous inserts into the same GiST key can surface as an exclusion
    // violation or as a deadlock; either way only one transaction may commit.
    expect(
      results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => findPostgresError(result.reason)?.code)
        .every((code) => code === '23P01' || code === '40P01'),
    ).toBe(true);

    const active = await db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM venue_allotments WHERE status = 'ACTIVE'
    `);
    expect(active.rows[0]?.total).toBe(1);
  });

  it('derives the reservation range from the request, never the client value', async () => {
    const data = await fixture();
    const request = await createRequest(data, '2026-12-03T10:00:00Z', '2026-12-03T12:00:00Z');
    const allotment = await createAllotment(data, request.id);

    const result = await db.execute<{ reserved: string }>(sql`
      SELECT reserved_range::text AS reserved FROM venue_allotments WHERE id = ${allotment.id}
    `);
    expect(result.rows[0]?.reserved).toBe(
      '["2026-12-03 09:30:00+00","2026-12-03 12:30:00+00")',
    );
  });

  it('keeps the audit trail append-only', async () => {
    await resetDatabase();
    const [row] = await db
      .insert(auditLogs)
      .values({
        actorId: null,
        action: 'TEST_ACTION',
        entityName: 'users',
        entityId: randomUUID(),
      })
      .returning();

    const tamper = await db
      .update(auditLogs)
      .set({ action: 'TAMPERED' })
      .where(sql`${auditLogs.id} = ${row!.id}`)
      .catch((error: unknown) => error);
    expect(findPostgresError(tamper)?.message).toMatch(/append-only/);
  });

  it('enforces submitted_by_id NOT NULL constraint and index presence', async () => {
    const colResult = await db.execute<{ is_nullable: string }>(sql`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'venue_requests' AND column_name = 'submitted_by_id'
    `);
    expect(colResult.rows[0]?.is_nullable).toBe('NO');

    const idxResult = await db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'venue_requests' AND indexname = 'venue_requests_submitted_by_idx'
    `);
    expect(idxResult.rows).toHaveLength(1);
  });

  it('calculates timezone-safe buffer ranges identically when session timezone is Asia/Kolkata', async () => {
    const data = await fixture();
    await db.execute(sql`SET TIME ZONE 'Asia/Kolkata'`);
    try {
      const request = await createRequest(data, '2026-12-03T10:00:00Z', '2026-12-03T12:00:00Z');
      const result = await db.execute<{ lower_utc: string; upper_utc: string }>(sql`
        SELECT
          (lower(effective_range) AT TIME ZONE 'UTC')::text AS lower_utc,
          (upper(effective_range) AT TIME ZONE 'UTC')::text AS upper_utc
        FROM venue_requests
        WHERE id = ${request.id}
      `);
      expect(result.rows[0]?.lower_utc).toBe('2026-12-03 09:30:00');
      expect(result.rows[0]?.upper_utc).toBe('2026-12-03 12:30:00');
    } finally {
      await db.execute(sql`SET TIME ZONE 'UTC'`);
    }
  });
});
