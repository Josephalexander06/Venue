import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WorkflowScopeType } from '@venue/shared';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';
import { type Database } from '../src/db/index.js';
import {
  approvalWorkflows,
  roles,
  userRoles,
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
} from './helpers.js';

describe('Phase 5 — Event collaboration, faculty endorsement and admin departments', () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(async () => {
    db = getTestDatabase();
    app = await buildApp({ db, env: parseEnv(process.env), logger: false });
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDatabase();
  });

  async function createVenueWithHodWorkflow(
    deptId: string | null,
    scopeType: WorkflowScopeType = 'CREATOR_DEPARTMENT',
  ) {
    const [wf] = await db
      .insert(approvalWorkflows)
      .values({
        name: 'HOD Only Workflow',
        description: 'Single step HOD approval',
      })
      .returning();

    await db.insert(workflowSteps).values({
      workflowId: wf!.id,
      stepOrder: 1,
      stepName: 'HOD Approval',
      requiredRole: 'HOD',
      scopeType,
      isFinalAllotmentStep: true,
    });

    const [v] = await db
      .insert(venues)
      .values({
        code: `SEM-${Date.now()}`,
        name: 'Seminar Hall A',
        building: 'Academic Block',
        floor: 1,
        capacity: 100,
        departmentId: deptId,
        workflowId: wf!.id,
        setupBufferMins: 15,
        teardownBufferMins: 15,
        isActive: true,
      })
      .returning();

    return { workflow: wf!, venue: v! };
  }

  it('enforces mandatory faculty coordinator before student can submit venue request', async () => {
    const student = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const faculty = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });
    const studentSession = await login(app, student.user.email, student.password);

    const { venue } = await createVenueWithHodWorkflow(student.department.id);

    // 1. Student creates draft event without faculty coordinator
    const createEventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(studentSession),
      payload: {
        title: 'Student Hackathon',
        description: 'Annual coding competition',
        expectedAttendance: 50,
      },
    });
    expect(createEventRes.statusCode).toBe(201);
    const { event } = createEventRes.json();
    expect(event.facultyCoordinatorId).toBeNull();

    // 2. Student attempts to submit venue request without faculty coordinator -> fails 400
    const failRequestRes = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(studentSession),
      payload: {
        eventId: event.id,
        venueId: venue.id,
        startTime: '2026-11-25T10:00:00Z',
        endTime: '2026-11-25T13:00:00Z',
      },
    });
    expect(failRequestRes.statusCode).toBe(400);
    expect(failRequestRes.json().code).toBe('FACULTY_COORDINATOR_REQUIRED');

    // 3. Assign faculty coordinator
    const assignCoordRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/coordinator`,
      headers: mutationHeaders(studentSession),
      payload: {
        facultyCoordinatorId: faculty.user.id,
      },
    });
    expect(assignCoordRes.statusCode).toBe(200);
    expect(assignCoordRes.json().team.facultyCoordinator?.id).toBe(faculty.user.id);

    // 4. Now student submits venue request -> routes to Stage 0 (endorsement)
    const successRequestRes = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(studentSession),
      payload: {
        eventId: event.id,
        venueId: venue.id,
        startTime: '2026-11-25T10:00:00Z',
        endTime: '2026-11-25T13:00:00Z',
      },
    });
    expect(successRequestRes.statusCode).toBe(201);
    const { request } = successRequestRes.json();
    expect(request.currentStepOrder).toBe(0);
    expect(request.requiresFacultyEndorsement).toBe(true);
    expect(request.facultyEndorserId).toBeNull();
  });

  it('lists and accepts active faculty across departments without exposing contact information', async () => {
    const student = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const meFaculty = await createTestUser({ role: 'FACULTY', departmentCode: 'ME' });
    const otherStudent = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const inactive = await createTestUser({ role: 'FACULTY', departmentCode: 'ME', status: 'SUSPENDED' });
    const studentSession = await login(app, student.user.email, student.password);

    const csFaculty = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });
    const hod = await createTestUser({ role: 'HOD', departmentCode: 'ME' });
    const admin = await createTestUser({ role: 'ADMINISTRATOR', departmentCode: 'ME' });
    const [facultyRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'FACULTY'));
    await db.insert(userRoles).values([
      { userId: hod.user.id, roleId: facultyRole!.id, departmentId: hod.department.id },
      { userId: admin.user.id, roleId: facultyRole!.id, departmentId: admin.department.id },
    ]);
    const directoryUrl = '/api/v1/events/faculty-candidates';
    expect((await app.inject(directoryUrl)).statusCode).toBe(401);
    const directory = await app.inject({ url: `${directoryUrl}?departmentId=${meFaculty.department.id}`, headers: mutationHeaders(studentSession) });
    expect(directory.statusCode).toBe(200);
    expect(directory.json().candidates).toEqual([{
      userId: meFaculty.user.id,
      firstName: meFaculty.user.firstName,
      lastName: meFaculty.user.lastName,
      departmentName: meFaculty.department.name,
    }]);

    const byDepartment = await app.inject({
      url: `/api/v1/departments/${csFaculty.department.id}/faculty`,
      headers: mutationHeaders(studentSession),
    });
    expect(byDepartment.json().faculty.map((person: { userId: string }) => person.userId)).toEqual([csFaculty.user.id]);

    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(studentSession),
      payload: {
        title: 'Robotics Workshop',
        expectedAttendance: 30,
      },
    });
    const { event } = eventRes.json();

    // Cross-department faculty
    const crossDeptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/coordinator`,
      headers: mutationHeaders(studentSession),
      payload: { facultyCoordinatorId: meFaculty.user.id },
    });
    expect(crossDeptRes.statusCode).toBe(200);
    expect(crossDeptRes.json().team.facultyCoordinator.userId).toBe(meFaculty.user.id);

    for (const elevated of [hod, admin]) {
      const response = await app.inject({
        method: 'POST', url: `/api/v1/events/${event.id}/coordinator`,
        headers: mutationHeaders(studentSession), payload: { facultyCoordinatorId: elevated.user.id },
      });
      expect(response.json()).toMatchObject({ statusCode: 400, code: 'INVALID_FACULTY_COORDINATOR' });
    }

    // Student role as coordinator
    const studentCoordRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/coordinator`,
      headers: mutationHeaders(studentSession),
      payload: { facultyCoordinatorId: otherStudent.user.id },
    });
    expect(studentCoordRes.statusCode).toBe(400);
    expect(studentCoordRes.json().code).toBe('INVALID_FACULTY_COORDINATOR');

    const inactiveCoordRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/coordinator`,
      headers: mutationHeaders(studentSession),
      payload: { facultyCoordinatorId: inactive.user.id },
    });
    expect(inactiveCoordRes.statusCode).toBe(400);
    expect(inactiveCoordRes.json().code).toBe('INVALID_FACULTY_COORDINATOR');
  });

  it('supports event collaboration: student organizers can submit requests for the event', async () => {
    const creator = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const organizer = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const outsider = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const faculty = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });

    const creatorSession = await login(app, creator.user.email, creator.password);
    const organizerSession = await login(app, organizer.user.email, organizer.password);
    const outsiderSession = await login(app, outsider.user.email, outsider.password);

    const { venue } = await createVenueWithHodWorkflow(creator.department.id);

    // Creator creates event with faculty coordinator
    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(creatorSession),
      payload: {
        title: 'Team Collaboration Event',
        expectedAttendance: 40,
        facultyCoordinatorId: faculty.user.id,
      },
    });
    const { event } = eventRes.json();

    // Event managers can search active users for co-organizer assignment
    const candidatesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/organizer-candidates?search=${encodeURIComponent(organizer.user.email)}`,
      headers: mutationHeaders(creatorSession),
    });
    expect(candidatesRes.statusCode).toBe(200);
    expect(candidatesRes.json().candidates.map((c: { userId: string }) => c.userId)).toContain(
      organizer.user.id,
    );

    // Outsiders cannot enumerate users through the event team endpoint
    const forbiddenCandidatesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/organizer-candidates?search=college.edu`,
      headers: mutationHeaders(outsiderSession),
    });
    expect(forbiddenCandidatesRes.statusCode).toBe(403);

    // Add organizer
    const addOrgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/organizers`,
      headers: mutationHeaders(creatorSession),
      payload: { userId: organizer.user.id },
    });
    expect(addOrgRes.statusCode).toBe(201);

    // Check team view
    const teamRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/team`,
      headers: mutationHeaders(creatorSession),
    });
    expect(teamRes.statusCode).toBe(200);
    const { team } = teamRes.json();
    expect(team.organizers).toHaveLength(1);
    expect(team.organizers[0].userId).toBe(organizer.user.id);
    expect(team.facultyCoordinator?.id).toBe(faculty.user.id);

    // Outsider cannot submit venue request for this event
    const outsiderReqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(outsiderSession),
      payload: {
        eventId: event.id,
        venueId: venue.id,
        startTime: '2026-11-26T10:00:00Z',
        endTime: '2026-11-26T12:00:00Z',
      },
    });
    expect(outsiderReqRes.statusCode).toBe(403);
    expect(outsiderReqRes.json().code).toBe('EVENT_ACCESS_FORBIDDEN');

    // Organizer CAN submit venue request for this event
    const orgReqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(organizerSession),
      payload: {
        eventId: event.id,
        venueId: venue.id,
        startTime: '2026-11-26T10:00:00Z',
        endTime: '2026-11-26T12:00:00Z',
      },
    });
    expect(orgReqRes.statusCode).toBe(201);
    const { request: req } = orgReqRes.json();
    expect(req.submittedById).toBe(organizer.user.id);
    expect(req.currentStepOrder).toBe(0);
    expect(req.requiresFacultyEndorsement).toBe(true);

    // Remove organizer
    const removeOrgRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${event.id}/organizers/${organizer.user.id}`,
      headers: mutationHeaders(creatorSession),
    });
    expect(removeOrgRes.statusCode).toBe(200);
  });

  it('routes endorsement to the assigned coordinator and HOD approval to the venue owner', async () => {
    const student = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const coordinator = await createTestUser({ role: 'FACULTY', departmentCode: 'ME' });
    const otherFaculty = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });
    const hod = await createTestUser({ role: 'HOD', departmentCode: 'ME' });
    const studentHod = await createTestUser({ role: 'HOD', departmentCode: 'CS' });

    const studentSession = await login(app, student.user.email, student.password);
    const coordSession = await login(app, coordinator.user.email, coordinator.password);
    const otherFacultySession = await login(app, otherFaculty.user.email, otherFaculty.password);
    const hodSession = await login(app, hod.user.email, hod.password);
    const studentHodSession = await login(app, studentHod.user.email, studentHod.password);

    const { venue } = await createVenueWithHodWorkflow(hod.department.id);

    // Create event and request
    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(studentSession),
      payload: {
        title: 'AI Symposium',
        expectedAttendance: 60,
        facultyCoordinatorId: coordinator.user.id,
      },
    });
    const { event } = eventRes.json();

    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(studentSession),
      payload: {
        eventId: event.id,
        venueId: venue.id,
        startTime: '2026-11-27T14:00:00Z',
        endTime: '2026-11-27T17:00:00Z',
      },
    });
    const { request } = reqRes.json();

    const inboxUrl = '/api/v1/approvals/inbox';
    const beforeEndorsement = await app.inject({ url: inboxUrl, headers: mutationHeaders(hodSession) });
    expect(beforeEndorsement.json().items).toEqual([]);

    // 1. Request appears in assigned coordinator's inbox
    const coordInboxRes = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/inbox',
      headers: mutationHeaders(coordSession),
    });
    expect(coordInboxRes.statusCode).toBe(200);
    const coordInbox = coordInboxRes.json();
    expect(
      coordInbox.items.some(
        (item: { request: { id: string } }) => item.request.id === request.id,
      ),
    ).toBe(true);

    // 2. Request does NOT appear in other faculty's inbox
    const otherInboxRes = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/inbox',
      headers: mutationHeaders(otherFacultySession),
    });
    expect(otherInboxRes.statusCode).toBe(200);
    const otherInbox = otherInboxRes.json();
    expect(
      otherInbox.items.some(
        (item: { request: { id: string } }) => item.request.id === request.id,
      ),
    ).toBe(false);

    // 3. Other faculty cannot endorse/reject -> 403
    const unauthorizedDecisionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(otherFacultySession),
      payload: { decision: 'APPROVED' },
    });
    expect(unauthorizedDecisionRes.statusCode).toBe(403);
    expect(unauthorizedDecisionRes.json().code).toBe('APPROVAL_FORBIDDEN');

    // 4. Submitter cannot self-endorse
    const selfDecisionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(studentSession),
      payload: { decision: 'APPROVED' },
    });
    expect(selfDecisionRes.statusCode).toBe(403);

    // 5. Coordinator requests changes
    const changesRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(coordSession),
      payload: { decision: 'CHANGES_REQUESTED', comments: 'Please attach detailed speaker agenda' },
    });
    expect(changesRes.statusCode).toBe(200);
    expect(changesRes.json().request.status).toBe('SUBMITTED');

    // 6. Coordinator approves -> advances to Stage 1 (HOD)
    const endorseRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(coordSession),
      payload: { decision: 'APPROVED', comments: 'Endorsed. Meets all department safety protocols.' },
    });
    expect(endorseRes.statusCode).toBe(200);
    const endorsed = endorseRes.json();
    expect(endorsed.request.currentStepOrder).toBe(1);
    expect(endorsed.request.facultyEndorserId).toBe(coordinator.user.id);
    expect(endorsed.request.facultyEndorsedAt).toBeTruthy();

    const ownerInbox = await app.inject({ url: inboxUrl, headers: mutationHeaders(hodSession) });
    expect(ownerInbox.json().items).toMatchObject([{
      request: { id: request.id },
      step: { stepOrder: 1, scopeType: 'VENUE_DEPARTMENT' },
    }]);
    const studentHodInbox = await app.inject({ url: inboxUrl, headers: mutationHeaders(studentHodSession) });
    expect(studentHodInbox.json().items).toEqual([]);
    const wrongHodDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(studentHodSession),
      payload: { decision: 'APPROVED' },
    });
    expect(wrongHodDecision.statusCode).toBe(403);

    // 7. Now HOD can approve the request
    const hodDecisionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(hodSession),
      payload: { decision: 'APPROVED', comments: 'Department approval granted.' },
    });
    expect(hodDecisionRes.statusCode).toBe(200);
    expect(hodDecisionRes.json().outcome.status).toBe('APPROVED_PENDING_ALLOTMENT');

    // 8. HOD completes final allotment
    const allotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(hodSession),
      payload: { venueRequestId: request.id },
    });
    expect(allotRes.statusCode).toBe(200);
    expect(allotRes.json().allotmentId).toBeTruthy();

    const [finalReq] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(finalReq?.status).toBe('CONFIRMED');
  });

  it.each(['COLLEGE_WIDE', 'CREATOR_DEPARTMENT', 'VENUE_DEPARTMENT'] as const)(
    'honors %s scope for a college-wide venue',
    async (scopeType) => {
      const faculty = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });
      const hod = await createTestUser({ role: 'HOD', departmentCode: 'ME' });
      const facultySession = await login(app, faculty.user.email, faculty.password);
      const { venue } = await createVenueWithHodWorkflow(null, scopeType);
      const headers = mutationHeaders(facultySession);
      const event = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers,
        payload: { title: 'College Workshop', expectedAttendance: 25 },
      });
      const submission = await app.inject({
        method: 'POST',
        url: '/api/v1/venue-requests',
        headers,
        payload: {
          eventId: event.json().event.id,
          venueId: venue.id,
          startTime: '2026-11-27T14:00:00Z',
          endTime: '2026-11-27T17:00:00Z',
        },
      });
      if (scopeType === 'VENUE_DEPARTMENT') {
        expect(submission.statusCode).toBe(409);
        expect(submission.json().code).toBe('VENUE_WORKFLOW_SCOPE_INVALID');
        return;
      }
      expect(submission.statusCode).toBe(201);
      const hodSession = await login(app, hod.user.email, hod.password);
      const inbox = await app.inject({
        url: '/api/v1/approvals/inbox',
        headers: mutationHeaders(hodSession),
      });
      expect(inbox.statusCode).toBe(200);
      if (scopeType === 'COLLEGE_WIDE') {
        expect(inbox.json().items).toMatchObject([{
          request: { id: submission.json().request.id },
          step: { scopeType },
        }]);
      } else {
        expect(inbox.json().items).toEqual([]);
      }
    },
  );

  it('bypasses Stage 0 endorsement when request is submitted directly by faculty', async () => {
    const faculty = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });
    const facultySession = await login(app, faculty.user.email, faculty.password);

    const { venue } = await createVenueWithHodWorkflow(faculty.department.id);

    // Faculty creates event
    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(facultySession),
      payload: {
        title: 'Faculty Seminar',
        expectedAttendance: 25,
      },
    });
    const { event } = eventRes.json();

    // Faculty submits request directly
    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(facultySession),
      payload: {
        eventId: event.id,
        venueId: venue.id,
        startTime: '2026-11-28T09:00:00Z',
        endTime: '2026-11-28T11:00:00Z',
      },
    });
    expect(reqRes.statusCode).toBe(201);
    const { request: req } = reqRes.json();
    expect(req.requiresFacultyEndorsement).toBe(false);
    expect(req.currentStepOrder).toBe(1); // Directly Stage 1 (HOD)
  });

  it('resets workflow back to Stage 0 on critical edits to student-submitted request', async () => {
    const student = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const coordinator = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });
    const studentSession = await login(app, student.user.email, student.password);
    const coordSession = await login(app, coordinator.user.email, coordinator.password);

    const { venue } = await createVenueWithHodWorkflow(student.department.id);

    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(studentSession),
      payload: {
        title: 'Annual Debate',
        expectedAttendance: 50,
        facultyCoordinatorId: coordinator.user.id,
      },
    });
    const { event } = eventRes.json();

    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(studentSession),
      payload: {
        eventId: event.id,
        venueId: venue.id,
        startTime: '2026-11-29T10:00:00Z',
        endTime: '2026-11-29T12:00:00Z',
      },
    });
    const { request } = reqRes.json();

    // Faculty endorses request -> advances to Step 1
    await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${request.id}/decision`,
      headers: mutationHeaders(coordSession),
      payload: { decision: 'APPROVED' },
    });

    const [afterEndorsement] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(afterEndorsement?.currentStepOrder).toBe(1);

    // Student modifies time slot (critical edit)
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/venue-requests/${request.id}`,
      headers: mutationHeaders(studentSession),
      payload: {
        startTime: '2026-11-29T11:00:00Z',
        endTime: '2026-11-29T13:00:00Z',
      },
    });
    expect(updateRes.statusCode).toBe(200);

    // Must reset to Step 0 and require endorsement again
    const [afterEdit] = await db
      .select()
      .from(venueRequests)
      .where(eq(venueRequests.id, request.id));
    expect(afterEdit?.currentStepOrder).toBe(0);
    expect(afterEdit?.status).toBe('SUBMITTED');
    expect(afterEdit?.facultyEndorserId).toBeNull();
  });

  it('scopes the HOD directory to the department they lead', async () => {
    const hod = await createTestUser({ role: 'HOD', departmentCode: 'CS' });
    const faculty = await createTestUser({ role: 'FACULTY', departmentCode: 'ME' });
    const { venue } = await createVenueWithHodWorkflow(hod.department.id);
    const { venue: otherVenue } = await createVenueWithHodWorkflow(faculty.department.id);
    const session = await login(app, hod.user.email, hod.password);
    const headers = mutationHeaders(session);
    const path = `/api/v1/departments/${hod.department.id}`;
    const members = await app.inject({ url: `${path}/members`, headers });
    expect(members.statusCode).toBe(200);
    expect(members.json()).toMatchObject({ total: 1, members: [{ id: hod.user.id, roles: ['HOD'] }] });
    expect(members.json().members[0]).not.toHaveProperty('phone');
    const ownVenues = (await app.inject({ url: `${path}/venues`, headers })).json();
    expect(ownVenues).toMatchObject({ total: 1, venues: [{ id: venue.id }] });
    expect(ownVenues.venues).not.toContainEqual(expect.objectContaining({ id: otherVenue.id }));

    for (const view of ['members', 'venues']) {
      const denied = await app.inject({ url: `/api/v1/departments/${faculty.department.id}/${view}`, headers });
      expect(denied.statusCode).toBe(403);
      const other = await login(app, faculty.user.email, faculty.password);
      expect((await app.inject({ url: `${path}/${view}`, headers: mutationHeaders(other) })).statusCode).toBe(403);
    }
  });

  it('supports administrative department management and department faculty listing', async () => {
    const admin = await createTestUser({ role: 'ADMINISTRATOR' });
    const faculty = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });
    const adminSession = await login(app, admin.user.email, admin.password);

    // 1. List admin departments with metrics
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/departments',
      headers: mutationHeaders(adminSession),
    });
    expect(listRes.statusCode).toBe(200);
    const { departments: depts } = listRes.json<{ departments: { id: string; code: string }[] }>();
    expect(Array.isArray(depts)).toBe(true);
    expect(depts.some((d) => d.code === 'CS')).toBe(true);

    // 2. Create new department
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/departments',
      headers: mutationHeaders(adminSession),
      payload: {
        code: 'EE',
        name: 'Electrical Engineering',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { department: newDept } = createRes.json();
    expect(newDept.code).toBe('EE');

    // 3. Update department
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/departments/${newDept.id}`,
      headers: mutationHeaders(adminSession),
      payload: {
        name: 'Electrical and Electronics Engineering',
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().department.name).toBe('Electrical and Electronics Engineering');

    // 4. Delete empty department
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/departments/${newDept.id}`,
      headers: mutationHeaders(adminSession),
    });
    expect(deleteRes.statusCode).toBe(204);

    // 5. Query department faculty
    const csDept = depts.find((d) => d.code === 'CS');
    const facultyListRes = await app.inject({
      method: 'GET',
      url: `/api/v1/departments/${csDept!.id}/faculty`,
      headers: mutationHeaders(adminSession),
    });
    expect(facultyListRes.statusCode).toBe(200);
    const { faculty: csFaculty } = facultyListRes.json<{ faculty: { id: string }[] }>();
    expect(csFaculty.some((f) => f.id === faculty.user.id)).toBe(true);
  });

  it('prevents event collaborators and faculty coordinators from approving or allotting their own events while preserving Stage 0 endorsement', async () => {
    const student = await createTestUser({ role: 'STUDENT', departmentCode: 'CS' });
    const facultyCoordinator = await createTestUser({ role: 'FACULTY', departmentCode: 'CS' });
    const collaboratorHod = await createTestUser({ role: 'HOD', departmentCode: 'CS' });
    const independentHod = await createTestUser({ role: 'HOD', departmentCode: 'CS' });

    const studentSession = await login(app, student.user.email, student.password);
    const coordSession = await login(app, facultyCoordinator.user.email, facultyCoordinator.password);
    const collabHodSession = await login(app, collaboratorHod.user.email, collaboratorHod.password);
    const indepHodSession = await login(app, independentHod.user.email, independentHod.password);

    const { venue } = await createVenueWithHodWorkflow(student.department.id);

    // 1. Student creates event with faculty coordinator
    const createEventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: mutationHeaders(studentSession),
      payload: {
        title: 'Separation of Duties Event',
        description: 'Audit test for collaborator self-approval',
        expectedAttendance: 40,
        facultyCoordinatorId: facultyCoordinator.user.id,
      },
    });
    expect(createEventRes.statusCode).toBe(201);
    const { event } = createEventRes.json();

    // 2. Add collaboratorHod as an event team member
    const addTeamRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${event.id}/organizers`,
      headers: mutationHeaders(studentSession),
      payload: { userId: collaboratorHod.user.id },
    });
    expect(addTeamRes.statusCode).toBe(201);

    // 3. Student submits venue request
    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/venue-requests',
      headers: mutationHeaders(studentSession),
      payload: {
        eventId: event.id,
        venueId: venue.id,
        startTime: '2026-12-15T10:00:00Z',
        endTime: '2026-12-15T12:00:00Z',
      },
    });
    expect(reqRes.statusCode).toBe(201);
    const reqId = reqRes.json().request.id;

    // 4. Faculty Coordinator legitimate endorsement at Stage 0 succeeds
    const endorseRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${reqId}/decision`,
      headers: mutationHeaders(coordSession),
      payload: { decision: 'APPROVED' },
    });
    expect(endorseRes.statusCode).toBe(200);

    // 5. Collaborator HOD attempts to approve Stage 1 (own event) -> 403 SELF_APPROVAL_FORBIDDEN
    const collabApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${reqId}/decision`,
      headers: mutationHeaders(collabHodSession),
      payload: { decision: 'APPROVED' },
    });
    expect(collabApproveRes.statusCode).toBe(403);
    expect(collabApproveRes.json().code).toBe('SELF_APPROVAL_FORBIDDEN');

    // 6. Independent HOD approves Stage 1 -> 200
    const indepApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/approvals/${reqId}/decision`,
      headers: mutationHeaders(indepHodSession),
      payload: { decision: 'APPROVED' },
    });
    expect(indepApproveRes.statusCode).toBe(200);

    // 7. Collaborator HOD attempts final allotment -> 403 SELF_APPROVAL_FORBIDDEN
    const collabAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(collabHodSession),
      payload: { venueRequestId: reqId },
    });
    expect(collabAllotRes.statusCode).toBe(403);
    expect(collabAllotRes.json().code).toBe('SELF_APPROVAL_FORBIDDEN');

    // 8. Faculty Coordinator attempts final allotment -> 403 SELF_APPROVAL_FORBIDDEN
    const coordAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(coordSession),
      payload: { venueRequestId: reqId },
    });
    expect(coordAllotRes.statusCode).toBe(403);
    expect(coordAllotRes.json().code).toBe('SELF_APPROVAL_FORBIDDEN');

    // 9. Independent HOD confirms final allotment -> 200
    const indepAllotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/allotments/confirm',
      headers: mutationHeaders(indepHodSession),
      payload: { venueRequestId: reqId },
    });
    expect(indepAllotRes.statusCode).toBe(200);
    expect(indepAllotRes.json().status).toBe('ACTIVE');
  });
});
