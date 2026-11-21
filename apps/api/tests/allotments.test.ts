import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';
import type { Database } from '../src/db/index.js';
import {
  approvalDecisions,
  approvalInstances,
  approvalWorkflows,
  auditLogs,
  departments,
  venueAllotments,
  venueRequests,
  venues,
  workflowSteps,
} from '../src/db/schema.js';
import {
  closeTestDatabase,
  createTestUser,
  getTestDatabase,
  login,
  mutationHeaders,
  resetDatabase,
  type TestSession,
} from './helpers.js';

describe('Phase 4 — Atomic venue allotment & conflict resolution engine', () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(async () => {
    db = getTestDatabase();
    app = await buildApp({ db, env: parseEnv(process.env), logger: false });
  });

  afterAll(async () => {
    await app.close();
    await closeTestDatabase();
  });

  async function createEvent(
    session: TestSession,
    payload: { title: string; expectedAttendance: number; description?: string },
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(session),
      payload: {
        description: 'Test Event Description',
        ...payload,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`Event creation failed (${res.statusCode}): ${res.body}`);
    }
    return res.json<{ event: { id: string; title: string } }>().event;
  }

  async function createBookingRequest(
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

  async function approveStep(
    session: TestSession,
    requestId: string,
    comments = 'Approved in test',
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${requestId}/decision`,
      headers: mutationHeaders(session),
      payload: {
        decision: 'APPROVED',
        comments,
      },
    });
  }

  function approveAndAllot(
    session: TestSession,
    request: { id: string; updatedAt: string },
    reviewedCompetingRequestIds: string[] = [],
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/approve-and-allot`,
      headers: mutationHeaders(session),
      payload: { expectedUpdatedAt: request.updatedAt, reviewedCompetingRequestIds },
    });
  }

  async function setupFixtures() {
    await resetDatabase();

    const [
      adminUser,
      hodCsUser,
      hodMeUser,
      bursarUser,
      principalUser,
      student1User,
      student2User,
      facultyMeUser,
    ] = await Promise.all([
      createTestUser({ role: 'ADMINISTRATOR', email: 'admin@college.edu' }),
      createTestUser({ role: 'HOD', departmentCode: 'CS', email: 'hod-cs@college.edu' }),
      createTestUser({ role: 'HOD', departmentCode: 'ME', email: 'hod-me@college.edu' }),
      createTestUser({ role: 'BURSAR', email: 'bursar@college.edu' }),
      createTestUser({ role: 'PRINCIPAL', email: 'principal@college.edu' }),
      createTestUser({ role: 'FACULTY', departmentCode: 'CS', email: 'student1@college.edu' }),
      createTestUser({ role: 'FACULTY', departmentCode: 'CS', email: 'student2@college.edu' }),
      createTestUser({ role: 'FACULTY', departmentCode: 'ME', email: 'faculty-me@college.edu' }),
    ]);

    // 1. Single-step workflow (HOD only)
    const [hodOnlyWf] = await db
      .insert(approvalWorkflows)
      .values({
        name: `HOD Only Review ${randomUUID()}`,
        description: 'Single-step HOD review for department spaces',
        isDefault: false,
      })
      .returning();
    await db.insert(workflowSteps).values({
      workflowId: hodOnlyWf!.id,
      stepOrder: 1,
      stepName: 'Department HOD Review',
      requiredRole: 'HOD',
      scopeType: 'CREATOR_DEPARTMENT',
      isFinalAllotmentStep: true,
    });

    // 2. Multi-step workflow (HOD -> Bursar -> Principal)
    const [threeStepWf] = await db
      .insert(approvalWorkflows)
      .values({
        name: `Auditorium Review ${randomUUID()}`,
        description: 'HOD -> Bursar -> Principal sequential workflow',
        isDefault: true,
      })
      .returning();
    await db.insert(workflowSteps).values([
      {
        workflowId: threeStepWf!.id,
        stepOrder: 1,
        stepName: 'Department HOD Review',
        requiredRole: 'HOD',
        scopeType: 'CREATOR_DEPARTMENT',
        isFinalAllotmentStep: false,
      },
      {
        workflowId: threeStepWf!.id,
        stepOrder: 2,
        stepName: 'Bursar Logistics Check',
        requiredRole: 'BURSAR',
        scopeType: 'COLLEGE_WIDE',
        isFinalAllotmentStep: false,
      },
      {
        workflowId: threeStepWf!.id,
        stepOrder: 3,
        stepName: 'Principal Final Approval',
        requiredRole: 'PRINCIPAL',
        scopeType: 'COLLEGE_WIDE',
        isFinalAllotmentStep: true,
      },
    ]);

    // Departments
    const [csDept] = await db
      .select()
      .from(departments)
      .where(sql`${departments.code} = 'CS'`)
      .limit(1);

    // Venues
    const [deptLab] = await db
      .insert(venues)
      .values({
        code: `CS-LAB-${randomUUID().slice(0, 4).toUpperCase()}`,
        name: 'CS Seminar Lab',
        building: 'CS Block',
        floor: 1,
        capacity: 80,
        facilities: ['Projector', 'Air conditioning'],
        setupBufferMins: 15,
        teardownBufferMins: 15,
        departmentId: csDept!.id,
        workflowId: hodOnlyWf!.id,
      })
      .returning();

    const [auditorium] = await db
      .insert(venues)
      .values({
        code: `AUD-${randomUUID().slice(0, 4).toUpperCase()}`,
        name: 'Main Auditorium',
        building: 'Admin Block',
        floor: 0,
        capacity: 600,
        facilities: ['Stage', 'Sound System'],
        setupBufferMins: 30,
        teardownBufferMins: 30,
        departmentId: null,
        workflowId: threeStepWf!.id,
      })
      .returning();

    return {
      db,
      venues: { deptLab: deptLab!, auditorium: auditorium! },
      workflows: { hodOnly: hodOnlyWf!, threeStep: threeStepWf! },
      users: {
        admin: adminUser,
        hodCs: hodCsUser,
        hodMe: hodMeUser,
        bursar: bursarUser,
        principal: principalUser,
        student1: student1User,
        student2: student2User,
        facultyMe: facultyMeUser,
      },
    };
  }

  it('approves and allots in one action with scoped authorization and an idempotent retry', async () => {
    const { venues, users } = await setupFixtures();
    const [owner, hod, wrongHod] = await Promise.all([users.student1, users.hodCs, users.hodMe]
      .map(({ user, password }) => login(app, user.email, password)));
    const event = await createEvent(owner!, { title: 'One-action booking', expectedAttendance: 20 });
    const created = await createBookingRequest(owner!, event.id, venues.deptLab.id,
      '2026-12-10T10:00:00Z', '2026-12-10T12:00:00Z');
    expect(created.statusCode).toBe(201);
    const { request } = created.json();

    expect((await approveAndAllot(wrongHod!, request)).json().code).toBe('ALLOTMENT_FORBIDDEN');
    expect((await approveAndAllot(owner!, request)).json().code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(await db.select().from(approvalDecisions)).toHaveLength(0);
    expect(await db.select().from(venueAllotments)).toHaveLength(0);

    const response = await approveAndAllot(hod!, request);
    expect(response.statusCode).toBe(200);
    const retry = await approveAndAllot(hod!, request);
    expect(retry.json().allotmentId).toBe(response.json().allotmentId);
    const detail = await app.inject({ url: `/api/v1/venue-requests/${request.id}`, headers: mutationHeaders(owner!) });
    expect(detail.json()).toMatchObject({
      request: { status: 'CONFIRMED' },
      allotment: { id: response.json().allotmentId, status: 'ACTIVE' },
      decisions: [{ decision: 'APPROVED', stepOrder: 1 }],
    });
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs);
    expect(audits.filter(({ action }) => ['APPROVAL_APPROVED', 'ALLOTMENT_CONFIRMED'].includes(action)))
      .toHaveLength(2);
  });

  it('rolls back unreviewed competition and commits exactly one of two concurrent final decisions', async () => {
    const { venues, users } = await setupFixtures();
    const [ownerA, ownerB, hod] = await Promise.all([users.student1, users.student2, users.hodCs]
      .map(({ user, password }) => login(app, user.email, password)));
    async function requestFor(session: TestSession, title: string) {
      const event = await createEvent(session, { title, expectedAttendance: 20 });
      const result = await createBookingRequest(session, event.id, venues.deptLab.id,
        '2026-12-11T10:00:00Z', '2026-12-11T12:00:00Z');
      expect(result.statusCode).toBe(201);
      return result.json().request;
    }
    const a = await requestFor(ownerA!, 'First competing event');
    const b = await requestFor(ownerB!, 'Second competing event');
    const unseen = await approveAndAllot(hod!, a);
    expect(unseen.statusCode).toBe(409);
    expect(unseen.json().code).toBe('COMPETING_REQUESTS_CHANGED');
    expect(await db.select().from(approvalDecisions)).toHaveLength(0);
    expect(await db.select().from(venueAllotments)).toHaveLength(0);
    const before = await db.select().from(venueRequests);
    expect(before.map((request) => request.status)).toEqual(['SUBMITTED', 'SUBMITTED']);

    const outcomes = await Promise.all([
      approveAndAllot(hod!, a, [b.id]),
      approveAndAllot(hod!, b, [a.id]),
    ]);
    expect(outcomes.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(outcomes.find((result) => result.statusCode === 409)?.json().code).toBe('SLOT_ALREADY_ALLOTTED');
    expect(await db.select().from(venueAllotments)).toHaveLength(1);
    expect(await db.select().from(approvalDecisions)).toHaveLength(1);
    const after = await db.select().from(venueRequests);
    expect(after.map((request) => request.status).sort()).toEqual(['CONFIRMED', 'SUPERSEDED_CONFLICT']);
  });

  it('1. Single approved request allotment: transitions to CONFIRMED and creates active allotment', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student1.user.email, users.student1.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // Create event & request
    const event = await createEvent(studentSession, {
      title: 'CS Workshop',
      expectedAttendance: 45,
    });
    const reqRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.deptLab.id,
      '2026-12-10T10:00:00Z',
      '2026-12-10T12:00:00Z',
    );
    expect(reqRes.statusCode).toBe(201);
    const { request } = reqRes.json();

    // HOD approves preliminary step -> APPROVED_PENDING_ALLOTMENT
    const approveRes = await approveStep(hodCsSession, request.id);
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().outcome.status).toBe('APPROVED_PENDING_ALLOTMENT');

    // Confirm final allotment by authorized HOD
    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: {
        venueRequestId: request.id,
        remarks: 'Approved and allotted for CS workshop',
      },
    });

    expect(confirmRes.statusCode).toBe(200);
    const confirmBody = confirmRes.json();
    expect(confirmBody.status).toBe('ACTIVE');
    expect(confirmBody.allotmentId).toBeDefined();
    expect(confirmBody.supersededRequestsCount).toBe(0);

    // Verify DB state
    const [dbReq] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(dbReq?.status).toBe('CONFIRMED');

    const [allotment] = await db
      .select()
      .from(venueAllotments)
      .where(eq(venueAllotments.venueRequestId, request.id));
    expect(allotment).toBeDefined();
    expect(allotment?.status).toBe('ACTIVE');
    expect(allotment?.allottedBy).toBe(users.hodCs.user.id);

    // Verify audit log
    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityId, allotment!.id),
          eq(auditLogs.action, 'ALLOTMENT_CONFIRMED'),
        ),
      );
    expect(logs).toHaveLength(1);
  });

  it('2. Competing approved requests: exactly one wins and competitor is atomically superseded', async () => {
    const { venues, users } = await setupFixtures();
    const student1Session = await login(app, users.student1.user.email, users.student1.password);
    const student2Session = await login(app, users.student2.user.email, users.student2.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // Request A: 10:00 - 12:00
    const eventA = await createEvent(student1Session, {
      title: 'Coding Competition A',
      expectedAttendance: 50,
    });
    const reqResA = await createBookingRequest(
      student1Session,
      eventA.id,
      venues.deptLab.id,
      '2026-12-11T10:00:00Z',
      '2026-12-11T12:00:00Z',
    );
    const requestA = reqResA.json().request;

    // Request B (competing/overlapping): 11:00 - 13:00
    const eventB = await createEvent(student2Session, {
      title: 'Hackathon Prep B',
      expectedAttendance: 60,
    });
    const reqResB = await createBookingRequest(
      student2Session,
      eventB.id,
      venues.deptLab.id,
      '2026-12-11T11:00:00Z',
      '2026-12-11T13:00:00Z',
    );
    const requestB = reqResB.json().request;

    // HOD approves preliminary steps for both requests -> both enter APPROVED_PENDING_ALLOTMENT
    await approveStep(hodCsSession, requestA.id);
    await approveStep(hodCsSession, requestB.id);

    // Query competing requests endpoint for Request A
    const compRes = await app.inject({
      method: 'GET',
      url: `/api/v1/allotments/competing/${requestA.id}`,
      headers: { cookie: hodCsSession.cookie },
    });
    expect(compRes.statusCode).toBe(200);
    const compData = compRes.json();
    expect(compData.competingRequests).toHaveLength(1);
    expect(compData.competingRequests[0].request.id).toBe(requestB.id);
    expect(compData.competingRequests[0].event.title).toBe('Hackathon Prep B');
    expect(compData.competingRequests[0].event.department.code).toBe('CS');

    // HOD confirms allotment for Request A
    const confirmRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: {
        venueRequestId: requestA.id,
        remarks: 'Awarded to Coding Competition A',
      },
    });

    expect(confirmRes.statusCode).toBe(200);
    const confirmBody = confirmRes.json();
    expect(confirmBody.status).toBe('ACTIVE');
    expect(confirmBody.supersededRequestsCount).toBe(1);
    expect(confirmBody.supersededRequestIds).toContain(requestB.id);

    // Verify Request A is CONFIRMED
    const [dbA] = await db.select().from(venueRequests).where(eq(venueRequests.id, requestA.id));
    expect(dbA?.status).toBe('CONFIRMED');

    // Verify Request B is SUPERSEDED_CONFLICT with clear guidance
    const [dbB] = await db.select().from(venueRequests).where(eq(venueRequests.id, requestB.id));
    expect(dbB?.status).toBe('SUPERSEDED_CONFLICT');
    expect(dbB?.rejectionReason).toContain('Coding Competition A');
    expect(dbB?.rejectionReason).toContain('reschedule');

    // Verify Request B's approval instances are deactivated
    const instancesB = await db
      .select()
      .from(approvalInstances)
      .where(eq(approvalInstances.venueRequestId, requestB.id));
    expect(instancesB.every((i) => !i.isActive)).toBe(true);

    // Subsequent attempt to confirm Request B returns 409
    const secondConfirmRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: requestB.id },
    });
    expect(secondConfirmRes.statusCode).toBe(409);
    expect(secondConfirmRes.json().code).toBe('SLOT_ALREADY_ALLOTTED');
  });

  it('3. Concurrent final allotment attempts: exactly one succeeds and others fail cleanly', async () => {
    const { venues, users } = await setupFixtures();
    const student1Session = await login(app, users.student1.user.email, users.student1.password);
    const student2Session = await login(app, users.student2.user.email, users.student2.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // Create 2 overlapping requests
    const event1 = await createEvent(student1Session, {
      title: 'Parallel Event 1',
      expectedAttendance: 30,
    });
    const reqRes1 = await createBookingRequest(
      student1Session,
      event1.id,
      venues.deptLab.id,
      '2026-12-12T14:00:00Z',
      '2026-12-12T16:00:00Z',
    );
    const req1 = reqRes1.json().request;

    const event2 = await createEvent(student2Session, {
      title: 'Parallel Event 2',
      expectedAttendance: 35,
    });
    const reqRes2 = await createBookingRequest(
      student2Session,
      event2.id,
      venues.deptLab.id,
      '2026-12-12T15:00:00Z',
      '2026-12-12T17:00:00Z',
    );
    const req2 = reqRes2.json().request;

    // Approve both to APPROVED_PENDING_ALLOTMENT
    await approveStep(hodCsSession, req1.id);
    await approveStep(hodCsSession, req2.id);

    // Fire concurrent confirm requests
    const [result1, result2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/allotments/confirm',
        headers: mutationHeaders(hodCsSession),
        payload: { venueRequestId: req1.id },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/allotments/confirm',
        headers: mutationHeaders(hodCsSession),
        payload: { venueRequestId: req2.id },
      }),
    ]);

    const statuses = [result1.statusCode, result2.statusCode].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409); // Rejected with conflict

    // Exactly one active allotment exists in the database
    const activeAllotments = await db
      .select()
      .from(venueAllotments)
      .where(
        and(
          eq(venueAllotments.venueId, venues.deptLab.id),
          eq(venueAllotments.status, 'ACTIVE'),
        ),
      );
    expect(activeAllotments).toHaveLength(1);
  });

  it('4. Duplicate / idempotent allotment submissions return existing allotment', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student1.user.email, users.student1.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    const event = await createEvent(studentSession, {
      title: 'Idempotency Check Event',
      expectedAttendance: 25,
    });
    const reqRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.deptLab.id,
      '2026-12-13T10:00:00Z',
      '2026-12-13T12:00:00Z',
    );
    const request = reqRes.json().request;
    await approveStep(hodCsSession, request.id);

    // First allotment call
    const firstRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: request.id },
    });
    expect(firstRes.statusCode).toBe(200);
    const firstBody = firstRes.json();

    // Repeated allotment call for the same request
    const secondRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: request.id },
    });
    expect(secondRes.statusCode).toBe(200);
    const secondBody = secondRes.json();
    expect(secondBody.allotmentId).toBe(firstBody.allotmentId);
    expect(secondBody.status).toBe('ACTIVE');
    expect(secondBody.supersededRequestsCount).toBe(0);
  });

  it('5. Separation of duties: prevents self-allotment by request creator', async () => {
    const { venues, users } = await setupFixtures();
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);
    const adminSession = await login(app, users.admin.user.email, users.admin.password);

    // HOD creates their own event and request
    const event = await createEvent(hodCsSession, {
      title: 'HOD Faculty Meeting',
      expectedAttendance: 20,
    });
    const reqRes = await createBookingRequest(
      hodCsSession,
      event.id,
      venues.deptLab.id,
      '2026-12-14T09:00:00Z',
      '2026-12-14T11:00:00Z',
    );
    const request = reqRes.json().request;

    // Fast-forward to APPROVED_PENDING_ALLOTMENT
    await db
      .update(venueRequests)
      .set({ status: 'APPROVED_PENDING_ALLOTMENT' })
      .where(eq(venueRequests.id, request.id));

    // HOD attempts to allot their own request
    const selfAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: request.id },
    });
    expect(selfAllotRes.statusCode).toBe(403);
    expect(selfAllotRes.json().code).toBe('SELF_APPROVAL_FORBIDDEN');

    // Admin can allot with remarks
    const adminAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(adminSession),
      payload: {
        venueRequestId: request.id,
        remarks: 'Admin approved meeting for department head',
      },
    });
    expect(adminAllotRes.statusCode).toBe(200);
  });

  it('6. Unauthorized approver and cross-department access is denied', async () => {
    const { venues, users } = await setupFixtures();
    const student1Session = await login(app, users.student1.user.email, users.student1.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);
    const hodMeSession = await login(app, users.hodMe.user.email, users.hodMe.password);
    const bursarSession = await login(app, users.bursar.user.email, users.bursar.password);

    // CS Lab request
    const event = await createEvent(student1Session, {
      title: 'CS Specialized Lab',
      expectedAttendance: 30,
    });
    const reqRes = await createBookingRequest(
      student1Session,
      event.id,
      venues.deptLab.id,
      '2026-12-15T14:00:00Z',
      '2026-12-15T16:00:00Z',
    );
    const request = reqRes.json().request;
    await approveStep(hodCsSession, request.id);

    // ME HOD attempts to allot CS Lab
    const meRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodMeSession),
      payload: { venueRequestId: request.id },
    });
    expect(meRes.statusCode).toBe(403);
    expect(meRes.json().code).toBe('ALLOTMENT_FORBIDDEN');

    // Bursar attempts to allot CS Lab (workflow only authorizes HOD)
    const bursarRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(bursarSession),
      payload: { venueRequestId: request.id },
    });
    expect(bursarRes.statusCode).toBe(403);
    expect(bursarRes.json().code).toBe('ALLOTMENT_FORBIDDEN');

    // Student attempts to allot
    const studentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(student1Session),
      payload: { venueRequestId: request.id },
    });
    expect(studentRes.statusCode).toBe(403);
  });

  it('7. Administrative override requires remarks', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student1.user.email, users.student1.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);
    const adminSession = await login(app, users.admin.user.email, users.admin.password);

    const event = await createEvent(studentSession, {
      title: 'CS Research Symposium',
      expectedAttendance: 40,
    });
    const reqRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.deptLab.id,
      '2026-12-16T10:00:00Z',
      '2026-12-16T12:00:00Z',
    );
    const request = reqRes.json().request;
    await approveStep(hodCsSession, request.id);

    // Admin attempts override without remarks
    const noRemarksRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(adminSession),
      payload: { venueRequestId: request.id },
    });
    expect(noRemarksRes.statusCode).toBe(400);
    expect(noRemarksRes.json().code).toBe('OVERRIDE_REMARKS_REQUIRED');

    // Admin attempts override with short remarks (< 5 chars)
    const shortRemarksRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(adminSession),
      payload: { venueRequestId: request.id, remarks: 'ok' },
    });
    expect(shortRemarksRes.statusCode).toBe(400);

    // Admin provides valid override remarks
    const validRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(adminSession),
      payload: {
        venueRequestId: request.id,
        remarks: 'Executive dean approval for research symposium',
      },
    });
    expect(validRes.statusCode).toBe(200);

    // Verify audit log includes override remarks
    const logs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityId, validRes.json().allotmentId),
          eq(auditLogs.action, 'ALLOTMENT_CONFIRMED'),
        ),
      );
    expect(logs[0]?.newState).toMatchObject({
      isAdministrativeOverride: true,
      remarks: 'Executive dean approval for research symposium',
    });
  });

  it('8. Buffer overlaps enforce GiST exclusion constraint and trigger conflict resolution', async () => {
    const { venues, users } = await setupFixtures();
    const student1Session = await login(app, users.student1.user.email, users.student1.password);
    const student2Session = await login(app, users.student2.user.email, users.student2.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // deptLab has 15m setup and 15m teardown buffer
    // Event 1: 10:00 - 12:00 (buffered: 09:45 - 12:15)
    const event1 = await createEvent(student1Session, {
      title: 'Event Buffer 1',
      expectedAttendance: 20,
    });
    const reqRes1 = await createBookingRequest(
      student1Session,
      event1.id,
      venues.deptLab.id,
      '2026-12-17T10:00:00Z',
      '2026-12-17T12:00:00Z',
    );
    const req1 = reqRes1.json().request;

    // Event 2: 12:05 - 14:00 (buffered: 11:50 - 14:15, overlaps Event 1's teardown buffer 12:00 - 12:15!)
    const event2 = await createEvent(student2Session, {
      title: 'Event Buffer 2',
      expectedAttendance: 25,
    });
    const reqRes2 = await createBookingRequest(
      student2Session,
      event2.id,
      venues.deptLab.id,
      '2026-12-17T12:05:00Z',
      '2026-12-17T14:00:00Z',
    );
    const req2 = reqRes2.json().request;

    await approveStep(hodCsSession, req1.id);
    await approveStep(hodCsSession, req2.id);

    // Allot Event 1
    const allot1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: req1.id },
    });
    expect(allot1Res.statusCode).toBe(200);

    // Event 2 should be superseded because of the buffer overlap
    const [dbReq2] = await db.select().from(venueRequests).where(eq(venueRequests.id, req2.id));
    expect(dbReq2?.status).toBe('SUPERSEDED_CONFLICT');
  });

  it('9. Cancellation releases the GiST slot and allows re-allotment of the released time', async () => {
    const { venues, users } = await setupFixtures();
    const student1Session = await login(app, users.student1.user.email, users.student1.password);
    const student2Session = await login(app, users.student2.user.email, users.student2.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // Allot Request 1 for 10:00 - 12:00
    const event1 = await createEvent(student1Session, {
      title: 'Original Event',
      expectedAttendance: 30,
    });
    const reqRes1 = await createBookingRequest(
      student1Session,
      event1.id,
      venues.deptLab.id,
      '2026-12-18T10:00:00Z',
      '2026-12-18T12:00:00Z',
    );
    const req1 = reqRes1.json().request;
    await approveStep(hodCsSession, req1.id);

    const allotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: req1.id },
    });
    expect(allotRes.statusCode).toBe(200);
    const allotmentId = allotRes.json().allotmentId;

    // Cancel the allotment
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/allotments/${allotmentId}/cancel`,
      headers: mutationHeaders(hodCsSession),
      payload: { reason: 'Guest speaker travel cancelled' },
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelBody = cancelRes.json();
    expect(cancelBody.status).toBe('CANCELLED');
    expect(cancelBody.releasedRange).toBeDefined();

    // Verify allotment status in DB
    const [cancelledAllotment] = await db
      .select()
      .from(venueAllotments)
      .where(eq(venueAllotments.id, allotmentId));
    expect(cancelledAllotment?.status).toBe('CANCELLED');

    // Verify audit log for cancellation
    const cancelLogs = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityId, allotmentId),
          eq(auditLogs.action, 'ALLOTMENT_CANCELLED'),
        ),
      );
    expect(cancelLogs).toHaveLength(1);

    // Now, create a new request for the EXACT same slot and verify it can be confirmed!
    const event2 = await createEvent(student2Session, {
      title: 'Replacement Event',
      expectedAttendance: 35,
    });
    const reqRes2 = await createBookingRequest(
      student2Session,
      event2.id,
      venues.deptLab.id,
      '2026-12-18T10:00:00Z',
      '2026-12-18T12:00:00Z',
    );
    const req2 = reqRes2.json().request;
    await approveStep(hodCsSession, req2.id);

    const newAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: req2.id },
    });
    // This MUST succeed because the previous allotment was cancelled and the GiST constraint was released!
    expect(newAllotRes.statusCode).toBe(200);
    expect(newAllotRes.json().status).toBe('ACTIVE');
  });

  it('10. Multi-step workflow: final allotment authority rests strictly with the final approver (Principal)', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student1.user.email, users.student1.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);
    const bursarSession = await login(app, users.bursar.user.email, users.bursar.password);
    const principalSession = await login(app, users.principal.user.email, users.principal.password);

    // Auditorium request (Workflow: HOD -> Bursar -> Principal)
    const event = await createEvent(studentSession, {
      title: 'Annual College Cultural Fest',
      expectedAttendance: 500,
    });
    const reqRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.auditorium.id,
      '2026-12-20T09:00:00Z',
      '2026-12-20T17:00:00Z',
    );
    const request = reqRes.json().request;

    // Step 1: HOD CS approves
    const earlyFinal = await approveAndAllot(principalSession, request);
    expect(earlyFinal.statusCode).toBe(409);
    expect(earlyFinal.json().code).toBe('FINAL_APPROVAL_NOT_READY');
    expect(await db.select().from(approvalDecisions)).toHaveLength(0);
    const hodStepRes = await approveStep(hodCsSession, request.id);
    expect(hodStepRes.statusCode).toBe(200);
    expect(hodStepRes.json().outcome.status).toBe('IN_REVIEW');
    expect(hodStepRes.json().permissions.canApproveAndAllot).toBe(false);
    expect(await db.select().from(venueAllotments)).toHaveLength(0);

    // Step 2: Bursar approves
    const bursarStepRes = await approveStep(bursarSession, request.id);
    expect(bursarStepRes.statusCode).toBe(200);
    expect(bursarStepRes.json().outcome.status).toBe('IN_REVIEW');

    // Attempting allotment while IN_REVIEW fails
    const prematureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(principalSession),
      payload: { venueRequestId: request.id },
    });
    expect(prematureRes.statusCode).toBe(409);
    expect(prematureRes.json().code).toBe('REQUEST_NOT_READY_FOR_ALLOTMENT');

    // Step 3: Principal approves -> transitions to APPROVED_PENDING_ALLOTMENT
    const principalStepRes = await approveStep(principalSession, request.id);
    expect(principalStepRes.statusCode).toBe(200);
    expect(principalStepRes.json().outcome.status).toBe('APPROVED_PENDING_ALLOTMENT');

    // HOD attempts final allotment -> 403 (final step requires Principal)
    const hodAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: request.id },
    });
    expect(hodAllotRes.statusCode).toBe(403);
    expect(hodAllotRes.json().code).toBe('ALLOTMENT_FORBIDDEN');

    // Bursar attempts final allotment -> 403
    const bursarAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(bursarSession),
      payload: { venueRequestId: request.id },
    });
    expect(bursarAllotRes.statusCode).toBe(403);
    expect(bursarAllotRes.json().code).toBe('ALLOTMENT_FORBIDDEN');

    // Principal confirms allotment -> 200
    const principalAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(principalSession),
      payload: {
        venueRequestId: request.id,
        remarks: 'Approved by Principal for college annual day celebration',
      },
    });
    expect(principalAllotRes.statusCode).toBe(200);
    expect(principalAllotRes.json().status).toBe('ACTIVE');
  });

  it('11. Calendar reflects confirmed allotments and request details include permissions', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student1.user.email, users.student1.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    const event = await createEvent(studentSession, {
      title: 'Public Robotics Showcase',
      expectedAttendance: 60,
    });
    const reqRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.deptLab.id,
      '2026-12-22T10:00:00Z',
      '2026-12-22T13:00:00Z',
    );
    const request = reqRes.json().request;

    // Check request detail before approval: canAllot should be false
    const detailResBefore = await app.inject({
      method: 'GET',
      url: `/api/v1/venue-requests/${request.id}`,
      headers: { cookie: hodCsSession.cookie },
    });
    expect(detailResBefore.statusCode).toBe(200);
    expect(detailResBefore.json().permissions.canAllot).toBe(false);

    // HOD approves preliminary step
    await approveStep(hodCsSession, request.id);

    // Check request detail in APPROVED_PENDING_ALLOTMENT: canAllot should be true for HOD
    const detailResAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/venue-requests/${request.id}`,
      headers: { cookie: hodCsSession.cookie },
    });
    expect(detailResAfter.statusCode).toBe(200);
    expect(detailResAfter.json().permissions.canAllot).toBe(true);

    // Allot request
    const allotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodCsSession),
      payload: { venueRequestId: request.id },
    });
    expect(allotRes.statusCode).toBe(200);
    const allotmentId = allotRes.json().allotmentId;

    // Query calendar endpoint
    const calRes = await app.inject({
      method: 'GET',
      url: `/api/v1/venues/${venues.deptLab.id}/calendar?from=2026-12-22T00:00:00Z&to=2026-12-22T23:59:59Z`,
      headers: { cookie: studentSession.cookie },
    });
    expect(calRes.statusCode).toBe(200);
    const calData = calRes.json();
    expect(calData.entries.length).toBeGreaterThanOrEqual(1);
    const booked = calData.entries.find((a: { kind: string; id: string }) => a.kind === 'CONFIRMED' && a.id === allotmentId);
    expect(booked).toBeDefined();
    expect(booked.title).toBe('Public Robotics Showcase');

    // Check request detail now has allotment details and canCancelAllotment
    const detailResFinal = await app.inject({
      method: 'GET',
      url: `/api/v1/venue-requests/${request.id}`,
      headers: { cookie: hodCsSession.cookie },
    });
    expect(detailResFinal.statusCode).toBe(200);
    const finalData = detailResFinal.json();
    expect(finalData.allotment).toBeDefined();
    expect(finalData.allotment.status).toBe('ACTIVE');
    expect(finalData.permissions.canCancelAllotment).toBe(true);
  });

  it('12. Competitor discovery uses buffer-adjusted effective ranges and excludes closed requests', async () => {
    const { venues, users } = await setupFixtures();
    const student1Session = await login(app, users.student1.user.email, users.student1.password);
    const student2Session = await login(app, users.student2.user.email, users.student2.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // Target request: 10:00 to 12:00. deptLab has setupBufferMins: 30, teardown: 30.
    // Effective range of target is 09:30 to 12:30.
    const targetEvent = await createEvent(student1Session, {
      title: 'Target Request Event',
      expectedAttendance: 20,
    });
    const targetReqRes = await createBookingRequest(
      student1Session,
      targetEvent.id,
      venues.deptLab.id,
      '2026-12-25T10:00:00Z',
      '2026-12-25T12:00:00Z',
    );
    expect(targetReqRes.statusCode).toBe(201);
    const targetRequestId = targetReqRes.json().request.id;

    // Competitor A: 08:30 to 09:45. Raw times end before 10:00, but buffer range overlaps target's setup buffer!
    const compAEvent = await createEvent(student2Session, {
      title: 'Competitor A (Buffer Overlap)',
      expectedAttendance: 20,
    });
    const compARes = await createBookingRequest(
      student2Session,
      compAEvent.id,
      venues.deptLab.id,
      '2026-12-25T08:30:00Z',
      '2026-12-25T09:45:00Z',
    );
    expect(compARes.statusCode).toBe(201);
    const compAId = compARes.json().request.id;

    // Competitor B: Cancelled request during overlapping time
    const compBEvent = await createEvent(student2Session, {
      title: 'Competitor B (Cancelled)',
      expectedAttendance: 20,
    });
    const compBRes = await createBookingRequest(
      student2Session,
      compBEvent.id,
      venues.deptLab.id,
      '2026-12-25T11:00:00Z',
      '2026-12-25T13:00:00Z',
    );
    expect(compBRes.statusCode).toBe(201);
    const compBId = compBRes.json().request.id;
    await db
      .update(venueRequests)
      .set({ status: 'CANCELLED' })
      .where(eq(venueRequests.id, compBId));

    // Competitor C: Rejected request during overlapping time
    const compCEvent = await createEvent(student2Session, {
      title: 'Competitor C (Rejected)',
      expectedAttendance: 20,
    });
    const compCRes = await createBookingRequest(
      student2Session,
      compCEvent.id,
      venues.deptLab.id,
      '2026-12-25T11:00:00Z',
      '2026-12-25T13:00:00Z',
    );
    expect(compCRes.statusCode).toBe(201);
    const compCId = compCRes.json().request.id;
    await db
      .update(venueRequests)
      .set({ status: 'REJECTED', rejectionReason: 'Rejected' })
      .where(eq(venueRequests.id, compCId));

    // Call GET /api/v1/allotments/competing/:id as HOD
    const competingRes = await app.inject({
      method: 'GET',
      url: `/api/v1/allotments/competing/${targetRequestId}`,
      headers: { cookie: hodCsSession.cookie },
    });
    expect(competingRes.statusCode).toBe(200);
    const competingBody = competingRes.json();
    const competitorIds = competingBody.competingRequests.map(
      (c: { request: { id: string } }) => c.request.id,
    );

    // Competitor A must be discovered via buffer overlap
    expect(competitorIds).toContain(compAId);

    // Cancelled and Rejected competitors must NOT be returned
    expect(competitorIds).not.toContain(compBId);
    expect(competitorIds).not.toContain(compCId);
  });
});
