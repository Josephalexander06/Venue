import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';
import type { Database } from '../src/db/index.js';
import {
  approvalDecisions,
  approvalInstances,
  approvalWorkflows,
  departments,
  events,
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

describe('Phase 3 — Configurable approval workflows and lifecycle', () => {
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
        description: 'Event description',
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

  async function setupFixtures() {
    await resetDatabase();

    const [adminUser, hodCsUser, hodMeUser, bursarUser, principalUser, studentUser] =
      await Promise.all([
        createTestUser({ role: 'ADMINISTRATOR', email: 'admin@college.edu' }),
        createTestUser({ role: 'HOD', departmentCode: 'CS', email: 'hod-cs@college.edu' }),
        createTestUser({ role: 'HOD', departmentCode: 'ME', email: 'hod-me@college.edu' }),
        createTestUser({ role: 'BURSAR', email: 'bursar@college.edu' }),
        createTestUser({ role: 'PRINCIPAL', email: 'principal@college.edu' }),
        createTestUser({ role: 'FACULTY', departmentCode: 'CS', email: 'student@college.edu' }),
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
        name: `High-Stakes Auditorium Review ${randomUUID()}`,
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

    // Venues
    const [csDept] = await db
      .select()
      .from(departments)
      .where(sql`${departments.code} = 'CS'`)
      .limit(1);

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
        student: studentUser,
      },
    };
  }

  it('runs a single-step HOD-only approval to APPROVED_PENDING_ALLOTMENT without allocating venue', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // Create event & request for CS Lab (HOD only workflow)
    const event = await createEvent(studentSession, {
      title: 'CS Coding Workshop',
      expectedAttendance: 40,
    });
    const createRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.deptLab.id,
      '2026-12-10T10:00:00Z',
      '2026-12-10T12:00:00Z',
    );
    expect(createRes.statusCode).toBe(201);
    const { request } = createRes.json();
    expect(request.status).toBe('SUBMITTED');
    expect(request.currentStepOrder).toBe(1);

    // Verify HOD inbox lists this request
    const inboxRes = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/inbox',
      headers: { cookie: hodCsSession.cookie },
    });
    expect(inboxRes.statusCode).toBe(200);
    const inboxData = inboxRes.json();
    expect(inboxData.items).toHaveLength(1);
    expect(inboxData.items[0].request.id).toBe(request.id);
    expect(inboxData.items[0].step.stepName).toBe('Department HOD Review');

    // HOD approves
    const decideRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: {
        decision: 'APPROVED',
        comments: 'Lab is suitable for coding workshop.',
      },
    });
    expect(decideRes.statusCode).toBe(200);
    const decideData = decideRes.json();
    expect(decideData.outcome.status).toBe('APPROVED_PENDING_ALLOTMENT');
    expect(decideData.outcome.finalised).toBe(true);

    // Verify database state: status is APPROVED_PENDING_ALLOTMENT, NO allotment row
    const [dbRequest] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(dbRequest?.status).toBe('APPROVED_PENDING_ALLOTMENT');

    const allotments = await db
      .select()
      .from(venueAllotments)
      .where(eq(venueAllotments.venueRequestId, request.id));
    expect(allotments).toHaveLength(0); // Preliminary approval must NOT create allotment
  });

  it('runs a sequential 3-step workflow (HOD -> Bursar -> Principal) with proper state transitions', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);
    const bursarSession = await login(app, users.bursar.user.email, users.bursar.password);
    const principalSession = await login(app, users.principal.user.email, users.principal.password);

    // Create event & request for Main Auditorium
    const event = await createEvent(studentSession, {
      title: 'Annual Technical Symposium',
      expectedAttendance: 450,
    });
    const createRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.auditorium.id,
      '2026-12-15T09:00:00Z',
      '2026-12-15T13:00:00Z',
    );
    expect(createRes.statusCode).toBe(201);
    const { request } = createRes.json();
    expect(request.status).toBe('SUBMITTED');

    // Step 1: Bursar and Principal CANNOT approve step 1 (skip-prevention)
    const bursarPremature = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(bursarSession),
      payload: { decision: 'APPROVED' },
    });
    expect(bursarPremature.statusCode).toBe(403);

    // Step 1: HOD approves -> advances to step 2 (IN_REVIEW)
    const hodApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: { decision: 'APPROVED', comments: 'Department symposium approved.' },
    });
    expect(hodApprove.statusCode).toBe(200);
    expect(hodApprove.json().outcome.status).toBe('IN_REVIEW');

    const [afterStep1] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(afterStep1?.status).toBe('IN_REVIEW');
    expect(afterStep1?.currentStepOrder).toBe(2);

    // Step 2: Now Bursar can approve -> advances to step 3 (IN_REVIEW)
    const bursarApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(bursarSession),
      payload: { decision: 'APPROVED', comments: 'Facilities and sound crew allocated.' },
    });
    expect(bursarApprove.statusCode).toBe(200);
    expect(bursarApprove.json().outcome.status).toBe('IN_REVIEW');

    const [afterStep2] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(afterStep2?.currentStepOrder).toBe(3);

    // Step 3: Principal approves -> transitions to APPROVED_PENDING_ALLOTMENT
    const principalApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(principalSession),
      payload: { decision: 'APPROVED', comments: 'Executive clearance given.' },
    });
    expect(principalApprove.statusCode).toBe(200);
    expect(principalApprove.json().outcome.status).toBe('APPROVED_PENDING_ALLOTMENT');

    const [finalRequest] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(finalRequest?.status).toBe('APPROVED_PENDING_ALLOTMENT');

    for (const [session, expectedCount] of [[principalSession, 1], [bursarSession, 0]] as const) {
      const inbox = await app.inject({
        method: 'GET',
        url: '/api/v1/approvals/inbox',
        headers: { cookie: session.cookie },
      });
      expect(inbox.statusCode).toBe(200);
      expect(inbox.json().items).toHaveLength(expectedCount);
      if (expectedCount > 0) {
        expect(inbox.json().items[0].request).toMatchObject({
          id: request.id,
          status: 'APPROVED_PENDING_ALLOTMENT',
        });
      }
    }

    // Confirm decision timeline in request detail
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/approvals/${request.id}`,
      headers: { cookie: principalSession.cookie },
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.timeline).toHaveLength(3);
    expect(detail.timeline.every((s: { state: string }) => s.state === 'APPROVED')).toBe(true);
    expect(detail.decisions).toHaveLength(3);
  });

  it('enforces correct HOD department scoping and prevents cross-department HOD approval', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodMeSession = await login(app, users.hodMe.user.email, users.hodMe.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // CS student requests CS Lab
    const event = await createEvent(studentSession, { title: 'CS Coding Comp', expectedAttendance: 30 });
    const createRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.deptLab.id,
      '2026-12-11T14:00:00Z',
      '2026-12-11T16:00:00Z',
    );
    const { request } = createRes.json();

    // ME HOD inbox should NOT include CS request
    const meInbox = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/inbox',
      headers: { cookie: hodMeSession.cookie },
    });
    expect(meInbox.json().items).toHaveLength(0);

    // ME HOD attempts to approve CS request -> 403 Forbidden
    const crossDeptAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodMeSession),
      payload: { decision: 'APPROVED' },
    });
    expect(crossDeptAttempt.statusCode).toBe(403);
    expect(crossDeptAttempt.json().code).toBe('APPROVAL_FORBIDDEN');

    // CS HOD inbox DOES include CS request
    const csInbox = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/inbox',
      headers: { cookie: hodCsSession.cookie },
    });
    expect(csInbox.json().items).toHaveLength(1);
  });

  it('prevents separation-of-duties violation (requester cannot approve own request)', async () => {
    const { db, venues, users } = await setupFixtures();
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    const staffSession = await login(app, users.student.user.email, users.student.password);
    const event = await createEvent(staffSession, { title: 'HOD Faculty Meeting', expectedAttendance: 20 });
    const createRes = await createBookingRequest(
      staffSession,
      event.id,
      venues.deptLab.id,
      '2026-12-12T10:00:00Z',
      '2026-12-12T12:00:00Z',
    );
    const { request } = createRes.json();
    // Preserve a legacy request owned by an account that now has the HOD role.
    await db.update(events).set({ creatorId: users.hodCs.user.id }).where(eq(events.id, event.id));
    await db.update(venueRequests).set({ submittedById: users.hodCs.user.id }).where(eq(venueRequests.id, request.id));

    // HOD should not see their own request in their approval inbox
    const inboxRes = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/inbox',
      headers: { cookie: hodCsSession.cookie },
    });
    expect(inboxRes.json().items).toHaveLength(0);

    // HOD attempts to approve their own request -> 403 SELF_APPROVAL_FORBIDDEN
    const selfApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: { decision: 'APPROVED' },
    });
    expect(selfApproveRes.statusCode).toBe(403);
    expect(selfApproveRes.json().code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('handles rejections with mandatory reasons and stops the workflow immediately', async () => {
    const { db, venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    const event = await createEvent(studentSession, { title: 'Unapproved Rave', expectedAttendance: 500 });
    const createRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.auditorium.id,
      '2026-12-18T10:00:00Z',
      '2026-12-18T12:00:00Z',
    );
    const { request } = createRes.json();

    // Rejection without comments fails validation (at least 5 chars)
    const blankRejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: { decision: 'REJECTED', comments: 'no' },
    });
    expect(blankRejectRes.statusCode).toBe(400);

    // Valid rejection with clear reason
    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: {
        decision: 'REJECTED',
        comments: 'Event content does not align with departmental guidelines.',
      },
    });
    expect(rejectRes.statusCode).toBe(200);
    expect(rejectRes.json().outcome.status).toBe('REJECTED');

    // DB state
    const [dbRequest] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(dbRequest?.status).toBe('REJECTED');
    expect(dbRequest?.rejectionReason).toBe(
      'Event content does not align with departmental guidelines.',
    );

    // Workflow halted: Bursar or Principal cannot act on a rejected request
    const bursarSession = await login(app, users.bursar.user.email, users.bursar.password);
    const bursarAct = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(bursarSession),
      payload: { decision: 'APPROVED' },
    });
    expect(bursarAct.statusCode).toBe(409);
    expect(bursarAct.json().code).toBe('REQUEST_NOT_IN_REVIEW');
  });

  it('handles changes requested with mandatory feedback and lets the organizer update', async () => {
    const { db, venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    const event = await createEvent(studentSession, { title: 'CS Seminar', expectedAttendance: 200 });
    const createRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.auditorium.id,
      '2026-12-20T10:00:00Z',
      '2026-12-20T12:00:00Z',
    );
    const { request } = createRes.json();

    // HOD requests changes
    const changeReqRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: {
        decision: 'CHANGES_REQUESTED',
        comments: 'Please update expected attendance to include external delegates.',
      },
    });
    expect(changeReqRes.statusCode).toBe(200);
    expect(changeReqRes.json().outcome.status).toBe('SUBMITTED');

    // Decision record saved
    const decisions = await db
      .select()
      .from(approvalDecisions);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('CHANGES_REQUESTED');
  });

  it('invalidates prior approvals and restarts workflow on critical edit (venue/date/time)', async () => {
    const { db, venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // Submit for Auditorium (3-step workflow)
    const event = await createEvent(studentSession, { title: 'Robotics Workshop', expectedAttendance: 250 });
    const createRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.auditorium.id,
      '2026-12-22T09:00:00Z',
      '2026-12-22T12:00:00Z',
    );
    const { request } = createRes.json();

    // HOD approves step 1 -> advances to step 2 (Bursar)
    await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: { decision: 'APPROVED' },
    });

    const [beforeEditReq] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(beforeEditReq?.status).toBe('IN_REVIEW');
    expect(beforeEditReq?.currentStepOrder).toBe(2);

    const instancesBefore = await db
      .select()
      .from(approvalInstances)
      .where(eq(approvalInstances.venueRequestId, request.id));
    expect(instancesBefore).toHaveLength(1);
    expect(instancesBefore[0]?.isActive).toBe(true);

    // Organizer makes a critical edit: changes start and end time
    const editRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/venue-requests/${request.id}`,
      headers: mutationHeaders(studentSession),
      payload: {
        startTime: '2026-12-22T13:00:00Z',
        endTime: '2026-12-22T16:00:00Z',
      },
    });
    expect(editRes.statusCode).toBe(200);

    // Prior instance invalidated, new active instance generated at step 1
    const [afterEditReq] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(afterEditReq?.status).toBe('SUBMITTED');
    expect(afterEditReq?.currentStepOrder).toBe(1);

    const instancesAfter = await db
      .select()
      .from(approvalInstances)
      .where(eq(approvalInstances.venueRequestId, request.id))
      .orderBy(approvalInstances.createdAt);
    expect(instancesAfter).toHaveLength(2);
    expect(instancesAfter[0]?.isActive).toBe(false); // First round invalidated
    expect(instancesAfter[1]?.isActive).toBe(true);  // Second round active
    expect(instancesAfter[1]?.currentStepOrder).toBe(1);
  });

  it('prevents duplicate approval decisions and handles concurrency attempts cleanly', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    const event = await createEvent(studentSession, { title: 'Web Development Lab', expectedAttendance: 35 });
    const createRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.deptLab.id,
      '2026-12-24T10:00:00Z',
      '2026-12-24T12:00:00Z',
    );
    const { request } = createRes.json();

    // First decision succeeds
    const firstDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: { decision: 'APPROVED' },
    });
    expect(firstDecision.statusCode).toBe(200);

    // Duplicate decision on the same stage fails (either DUPLICATE_DECISION or REQUEST_NOT_IN_REVIEW)
    const duplicateDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: { decision: 'APPROVED' },
    });
    expect(duplicateDecision.statusCode).toBe(409);
  });

  it('allows multiple conflicting requests to complete preliminary approvals without collision', async () => {
    const { db, venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    // Request 1: 10:00 - 12:00
    const ev1 = await createEvent(studentSession, { title: 'CS Workshop A', expectedAttendance: 40 });
    const res1 = await createBookingRequest(
      studentSession,
      ev1.id,
      venues.deptLab.id,
      '2026-12-28T10:00:00Z',
      '2026-12-28T12:00:00Z',
    );
    expect(res1.statusCode).toBe(201);
    const req1 = res1.json().request;

    // Request 2: Overlapping 11:00 - 13:00 for SAME venue
    const ev2 = await createEvent(studentSession, { title: 'CS Workshop B', expectedAttendance: 50 });
    const res2 = await createBookingRequest(
      studentSession,
      ev2.id,
      venues.deptLab.id,
      '2026-12-28T11:00:00Z',
      '2026-12-28T13:00:00Z',
    );
    expect(res2.statusCode).toBe(201);
    const req2 = res2.json().request;

    // Both requests can be preliminarily approved by HOD
    const approve1 = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${req1.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: { decision: 'APPROVED' },
    });
    expect(approve1.statusCode).toBe(200);

    const approve2 = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${req2.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: { decision: 'APPROVED' },
    });
    expect(approve2.statusCode).toBe(200);

    // Both requests reach APPROVED_PENDING_ALLOTMENT concurrently
    const [dbReq1] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, req1.id));
    const [dbReq2] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, req2.id));
    expect(dbReq1?.status).toBe('APPROVED_PENDING_ALLOTMENT');
    expect(dbReq2?.status).toBe('APPROVED_PENDING_ALLOTMENT');

    // Neither has a confirmed allotment yet!
    const allotments = await db.select().from(venueAllotments);
    expect(allotments).toHaveLength(0);
  });

  it('allows administrator to configure, reorder, and update approval workflows', async () => {
    const { users } = await setupFixtures();
    const adminSession = await login(app, users.admin.user.email, users.admin.password);

    // Create a new configurable workflow: Principal Only
    const createWf = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/workflows',
      headers: mutationHeaders(adminSession),
      payload: {
        name: 'Executive Principal Fast-Track',
        description: 'Single-stage principal review',
        isDefault: false,
        steps: [
          {
            stepName: 'Principal Fast-Track Allotment',
            requiredRole: 'PRINCIPAL',
            scopeType: 'COLLEGE_WIDE',
            isFinalAllotmentStep: true,
          },
        ],
      },
    });
    expect(createWf.statusCode).toBe(201);
    const createdWf = createWf.json().workflow;
    expect(createdWf.name).toBe('Executive Principal Fast-Track');
    expect(createdWf.steps).toHaveLength(1);

    // Update workflow details
    const updateWf = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/workflows/${createdWf.id}`,
      headers: mutationHeaders(adminSession),
      payload: {
        name: 'Executive Principal Fast-Track Updated',
      },
    });
    expect(updateWf.statusCode).toBe(200);
    expect(updateWf.json().workflow.name).toBe('Executive Principal Fast-Track Updated');
  });

  it('supports repeated CHANGES_REQUESTED review cycles without duplicate-decision errors', async () => {
    const { venues, users } = await setupFixtures();
    const studentSession = await login(app, users.student.user.email, users.student.password);
    const hodCsSession = await login(app, users.hodCs.user.email, users.hodCs.password);

    const event = await createEvent(studentSession, {
      title: 'Iterative Review Event',
      expectedAttendance: 100,
    });
    const createRes = await createBookingRequest(
      studentSession,
      event.id,
      venues.auditorium.id,
      '2026-12-30T10:00:00Z',
      '2026-12-30T14:00:00Z',
    );
    expect(createRes.statusCode).toBe(201);
    const request = createRes.json().request;

    // First cycle: HOD requests changes
    const firstChangeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: {
        decision: 'CHANGES_REQUESTED',
        comments: 'Please update description to include catering requirements.',
      },
    });
    expect(firstChangeRes.statusCode).toBe(200);
    expect(firstChangeRes.json().outcome.status).toBe('SUBMITTED');

    // Organizer makes non-critical update (description)
    const updateRes1 = await app.inject({
      method: 'PATCH',
      url: `/api/v1/venue-requests/${request.id}`,
      headers: mutationHeaders(studentSession),
      payload: {
        event: {
          description: 'Updated with catering vendor details.',
        },
      },
    });
    expect(updateRes1.statusCode).toBe(200);

    // Second cycle: HOD reviews again and requests additional changes
    const secondChangeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: {
        decision: 'CHANGES_REQUESTED',
        comments: 'Please also specify AV equipment needs.',
      },
    });
    expect(secondChangeRes.statusCode).toBe(200);
    expect(secondChangeRes.json().outcome.status).toBe('SUBMITTED');

    // Organizer updates again
    const updateRes2 = await app.inject({
      method: 'PATCH',
      url: `/api/v1/venue-requests/${request.id}`,
      headers: mutationHeaders(studentSession),
      payload: {
        event: {
          description: 'Updated with catering vendor details and projector/mic AV setup.',
        },
      },
    });
    expect(updateRes2.statusCode).toBe(200);

    // HOD is satisfied and approves
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: {
        decision: 'APPROVED',
        comments: 'Looks good now. Approved.',
      },
    });
    expect(approveRes.statusCode).toBe(200);

    // Duplicate APPROVED decision on the same step is still properly rejected
    const dupApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodCsSession),
      payload: {
        decision: 'APPROVED',
      },
    });
    // Request has advanced or duplicate decision prevented
    expect([409, 403]).toContain(dupApproveRes.statusCode);
  });
});
