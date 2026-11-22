import { and, eq, inArray } from 'drizzle-orm';
import type { RoleName } from '@venue/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  approvalDecisions, approvalInstances, approvalWorkflows, auditLogs, eventOrganizers,
  events, venueAllotments, venueRequests, venues, workflowSteps,
} from '../src/db/schema.js';
import { parseEnv } from '../src/env.js';
import type { ApprovalInboxItem } from '../src/modules/approvals/service.js';
import type { RequestDetailView } from '../src/modules/requests/service.js';
import type { RequestView } from '../src/modules/requests/view.js';
import { createTestUser, getTestDatabase, login, mutationHeaders, resetDatabase } from './helpers.js';

const people = {
  studentCs: ['STUDENT', 'CS'], studentMe: ['STUDENT', 'ME'], organizer: ['STUDENT', 'CS'],
  facultyCs: ['FACULTY', 'CS'], facultyMe: ['FACULTY', 'ME'],
  hodCs: ['HOD', 'CS'], hodMe: ['HOD', 'ME'],
  principal: ['PRINCIPAL', 'ADMIN'], bursar: ['BURSAR', 'ADMIN'], admin: ['ADMINISTRATOR', 'ADMIN'],
} as const satisfies Record<string, readonly [RoleName, string]>;
type Actor = keyof typeof people;
type Approver = 'hodMe' | 'principal' | 'bursar';
const workflows: Array<[string, Approver[]]> = [
  ['HOD only', ['hodMe']],
  ['Principal only', ['principal']],
  ['Bursar only', ['bursar']],
  ['HOD → Bursar → Principal', ['hodMe', 'bursar', 'principal']],
];

function slot(day: number, hour = 10) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + day);
  start.setUTCHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

async function fixtures(app: FastifyInstance) {
  const db = getTestDatabase();
  const { departments } = await resetDatabase();
  const actors = new Map(await Promise.all(
    (Object.entries(people) as Array<[Actor, readonly [RoleName, string]]>).map(async ([name, [role, departmentCode]]) => {
      const { user, password } = await createTestUser({ email: `${name.toLowerCase()}@college.edu`, role, departmentCode });
      return [name, { id: user.id, session: await login(app, user.email, password) }] as const;
    }),
  ));
  const fixtureWorkflows: Array<[string, Approver[]]> = [
    ...workflows,
    ['Annex', ['principal']],
    ['Repeated HOD', ['hodMe', 'hodMe']],
  ];
  const spaces = new Map(await Promise.all(fixtureWorkflows.map(async ([name, steps]) => {
    const [workflow] = await db.insert(approvalWorkflows).values({ name }).returning();
    await db.insert(workflowSteps).values(steps.map<typeof workflowSteps.$inferInsert>((actor, index) => ({
      workflowId: workflow!.id,
      stepOrder: index + 1,
      stepName: `${actor} review ${index + 1}`,
      requiredRole: people[actor][0],
      scopeType: actor === 'hodMe' ? 'CREATOR_DEPARTMENT' : 'COLLEGE_WIDE',
      isFinalAllotmentStep: index === steps.length - 1,
    })));
    const [venue] = await db.insert(venues).values({
      code: `QA-${workflow!.id.slice(0, 8)}`, name, building: 'Engineering', floor: 0,
      capacity: name === 'Annex' ? 25 : 100, departmentId: departments.get('ME')!.id,
      workflowId: workflow!.id, setupBufferMins: 15, teardownBufferMins: 15,
    }).returning();
    return [name, venue!] as const;
  })));
  return { actors, spaces };
}

describe('booking scenario matrix', () => {
  const db = getTestDatabase();
  let app: FastifyInstance;
  let data: Awaited<ReturnType<typeof fixtures>>;

  beforeAll(async () => {
    app = await buildApp({ db, env: parseEnv(process.env), logger: false });
    data = await fixtures(app);
  });
  afterAll(async () => { await app.close(); });

  function api(method: 'GET' | 'POST' | 'PATCH', path: string, actor?: Actor, payload?: object) {
    return app.inject({ method, url: `/api/v1${path}`, headers: actor && mutationHeaders(data.actors.get(actor)!.session), payload });
  }

  async function createEvent(actor: Actor, title: string, coordinator?: Actor) {
    const response = await api('POST', '/events', actor, {
      title, expectedAttendance: 40, facultyCoordinatorId: coordinator && data.actors.get(coordinator)!.id,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ event: { id: string } }>().event;
  }

  async function submit(actor: Actor, eventId: string, space: string, time: ReturnType<typeof slot>) {
    const response = await api('POST', '/venue-requests', actor, { eventId, venueId: data.spaces.get(space)!.id, ...time });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<RequestDetailView>().request;
  }

  async function inbox(actor: Actor, query = '') {
    const response = await api('GET', `/approvals/inbox${query}`, actor);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ items: ApprovalInboxItem[]; total: number }>();
  }

  function decide(actor: Actor, request: RequestView, decision = 'APPROVED', comments?: string) {
    return api('POST', `/approvals/${request.id}/decision`, actor, { decision, comments, expectedUpdatedAt: request.updatedAt });
  }

  function final(actor: Actor, request: RequestView, reviewedCompetingRequestIds: string[] = []) {
    return api('POST', `/approvals/${request.id}/approve-and-allot`, actor, {
      expectedUpdatedAt: request.updatedAt, reviewedCompetingRequestIds,
    });
  }

  async function calendar(venueId: string, time: ReturnType<typeof slot>) {
    const response = await api('GET', `/venues/${venueId}/calendar?from=${time.startTime}&to=${time.endTime}`, 'studentCs');
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ entries: Array<{ requestId: string; kind: string }> }>().entries;
  }

  it.each(workflows)('routes and allots a student request through %s', async (name, chain) => {
    const time = slot(25);
    const event = await createEvent('studentCs', `${name} with cross-department endorsement`, 'facultyMe');
    let request = await submit('studentCs', event.id, name, time);
    const venueId = request.venue.id;
    expect(request).toMatchObject({ status: 'SUBMITTED', currentStepOrder: 0, requiresFacultyEndorsement: true });
    expect((await inbox('facultyMe')).items).toEqual(expect.arrayContaining([expect.objectContaining({ request: expect.objectContaining({ id: request.id }) })]));
    expect((await inbox('facultyCs')).items.map(({ request }) => request.id)).not.toContain(request.id);
    expect((await decide('facultyCs', request)).statusCode).toBe(403);
    expect((await calendar(venueId, time)).map(({ kind }) => kind)).toEqual(['PENDING']);
    const endorsement = await decide('facultyMe', request);
    expect(endorsement.statusCode, endorsement.body).toBe(200);
    request = endorsement.json<RequestDetailView>().request;

    for (const [index, actor] of chain.entries()) {
      expect(request.currentStepOrder).toBe(index + 1);
      const routing = await Promise.all((['hodCs', 'hodMe', 'principal', 'bursar'] as const).map(async (viewer) => ({
        viewer, present: (await inbox(viewer)).items.some((item) => item.request.id === request.id),
      })));
      expect(routing.filter(({ present }) => present).map(({ viewer }) => viewer)).toEqual([actor]);
      if (index === chain.length - 1) {
        const result = await final(actor, request);
        expect(result.statusCode, result.body).toBe(200);
        const retry = await final(actor, request);
        expect(retry.statusCode, retry.body).toBe(200);
        expect(retry.json().allotmentId).toBe(result.json().allotmentId);
      } else {
        const response = await decide(actor, request);
        expect(response.statusCode, response.body).toBe(200);
        request = response.json<RequestDetailView>().request;
      }
    }

    const [stored] = await db.select().from(venueRequests).where(eq(venueRequests.id, request.id));
    const [storedEvent] = await db.select().from(events).where(eq(events.id, event.id));
    const [round] = await db.select().from(approvalInstances).where(eq(approvalInstances.venueRequestId, request.id));
    const decisions = await db.select().from(approvalDecisions).where(eq(approvalDecisions.approvalInstanceId, round!.id)).orderBy(approvalDecisions.stepOrder);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, request.id)).orderBy(auditLogs.id);
    expect(stored).toMatchObject({ status: 'CONFIRMED', facultyEndorserId: data.actors.get('facultyMe')!.id });
    expect(storedEvent?.status).toBe('SUBMITTED');
    expect(round).toMatchObject({ isActive: false, isCompleted: true });
    expect(decisions.map(({ approverId }) => approverId)).toEqual(['facultyMe', ...chain].map((actor) => data.actors.get(actor as Actor)!.id));
    expect(audit.slice(1).map(({ oldState, newState }) => [oldState?.currentStepOrder, newState?.currentStepOrder])).toEqual(
      chain.map((_, index) => [index, index + 1]).concat([[chain.length, chain.length]]),
    );
    expect(await calendar(venueId, time)).toEqual([expect.objectContaining({ requestId: request.id, kind: 'CONFIRMED' })]);
    expect((await inbox(chain.at(-1)!)).items.map(({ request }) => request.id)).not.toContain(request.id);
  });

  it('resolves one concurrent winner, confirms independent slots, and releases a cancelled slot', async () => {
    const time = slot(30);
    const [eventA, eventB, laterEvent, otherEvent] = await Promise.all([
      createEvent('facultyCs', 'Booking candidate A'), createEvent('facultyMe', 'Booking candidate B'),
      createEvent('facultyCs', 'Same venue later'), createEvent('facultyMe', 'Independent venue'),
    ]);
    const [a, b, later, elsewhere] = await Promise.all([
      submit('facultyCs', eventA.id, 'Principal only', time), submit('facultyMe', eventB.id, 'Principal only', time),
      submit('facultyCs', laterEvent.id, 'Principal only', slot(30, 13)), submit('facultyMe', otherEvent.id, 'Bursar only', time),
    ]);
    const queue = await inbox('principal', '?limit=2');
    const nextPage = await inbox('principal', '?limit=2&offset=2');
    expect(queue.total).toBe(3);
    expect(nextPage.total).toBe(3);
    expect((await inbox('principal', '?offset=3')).total).toBe(3);
    const conflicts = new Map([...queue.items, ...nextPage.items].map((item) => [item.request.id, item.conflicts]));
    expect(conflicts.get(a.id)).toEqual({ pendingCount: 1, confirmedCount: 0 });
    expect(conflicts.get(b.id)).toEqual({ pendingCount: 1, confirmedCount: 0 });
    expect(conflicts.get(later.id)).toEqual({ pendingCount: 0, confirmedCount: 0 });
    const results = await Promise.all([final('principal', a, [b.id]), final('principal', b, [a.id]), final('principal', later), final('bursar', elsewhere)]);
    expect(results.slice(0, 2).map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(results.slice(2).map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    const winnerIndex = results[0]!.statusCode === 200 ? 0 : 1;
    const winner = [a, b][winnerIndex]!;
    const loser = [b, a][winnerIndex]!;
    const winnerOwner = (['facultyCs', 'facultyMe'] as const)[winnerIndex]!;
    const loserOwner = (['facultyMe', 'facultyCs'] as const)[winnerIndex]!;
    const active = await db.select().from(venueAllotments).where(and(inArray(venueAllotments.venueRequestId, [a.id, b.id, later.id]), eq(venueAllotments.status, 'ACTIVE')));
    expect(active.map(({ venueRequestId }) => venueRequestId).sort()).toEqual([winner.id, later.id].sort());
    const [superseded] = await db.select().from(venueRequests).where(eq(venueRequests.id, loser.id));
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, loser.id), eq(auditLogs.action, 'REQUEST_SUPERSEDED')));
    expect(superseded?.status).toBe('SUPERSEDED_CONFLICT');
    expect(audit?.newState).toMatchObject({ winningRequestId: winner.id });
    const allotmentId = results[winnerIndex]!.json().allotmentId as string;
    const cancelPath = `/allotments/${allotmentId}/cancel`;
    expect((await api('POST', cancelPath, 'studentMe', { reason: 'Unauthorized cancellation' })).statusCode).toBe(403);
    expect((await api('POST', cancelPath, winnerOwner, { reason: 'Organizer released the slot' })).statusCode).toBe(200);
    expect((await api('POST', cancelPath, 'studentMe', { reason: 'Unauthorized cancellation' })).statusCode).toBe(403);
    expect(await calendar(winner.venue.id, time)).toEqual([]);
    const [released] = await db.select().from(venueAllotments).where(eq(venueAllotments.id, allotmentId));
    expect(released?.status).toBe('CANCELLED');
    const rebooked = await submit(loserOwner, loser.eventId, 'Principal only', time);
    expect((await final('principal', rebooked)).statusCode).toBe(200);
    expect(await calendar(winner.venue.id, time)).toEqual([expect.objectContaining({ requestId: rebooked.id, kind: 'CONFIRMED' })]);
  });

  it('supports a faculty-created event with a student organizer and records one concurrent invite', async () => {
    const event = await createEvent('facultyCs', 'Faculty event with student organizer', 'facultyMe');
    const invite = () => api('POST', `/events/${event.id}/organizers`, 'facultyCs', { userId: data.actors.get('organizer')!.id });
    const invitations = await Promise.all([invite(), invite()]);
    expect(invitations.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);
    expect(invitations.find(({ statusCode }) => statusCode === 409)?.json().code).toBe('ORGANIZER_ALREADY_EXISTS');
    expect(await db.select().from(eventOrganizers).where(eq(eventOrganizers.eventId, event.id))).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, event.id), eq(auditLogs.action, 'EVENT_ORGANIZER_ADDED')))).toHaveLength(1);
    const time = slot(35);
    const request = await submit('organizer', event.id, 'HOD only', time);
    expect(request).toMatchObject({ currentStepOrder: 0, submittedById: data.actors.get('organizer')!.id });
    expect((await api('GET', `/approvals/${request.id}`)).statusCode).toBe(401);
    expect((await api('GET', `/approvals/${request.id}`, 'studentMe')).statusCode).toBe(404);
    expect((await api('GET', '/approvals/inbox', 'organizer')).statusCode).toBe(403);
    const endorsed = await decide('facultyMe', request);
    expect(endorsed.statusCode, endorsed.body).toBe(200);
    const result = await final('hodMe', endorsed.json<RequestDetailView>().request);
    expect(result.statusCode, result.body).toBe(200);
    const organizerView = await api('GET', `/approvals/${request.id}`, 'organizer');
    expect(organizerView.json<RequestDetailView>().permissions.canCancelAllotment).toBe(false);
    expect((await api('POST', `/allotments/${result.json().allotmentId}/cancel`, 'organizer', { reason: 'Outside organizer authority' })).statusCode).toBe(403);
    const filtered = await api('GET', `/venues?eventId=${event.id}`, 'organizer');
    expect(filtered.statusCode, filtered.body).toBe(200);
    const matches = filtered.json<{ venues: Array<{ id: string }> }>().venues.map(({ id }) => id);
    expect(matches).toContain(request.venue.id);
    expect(matches).not.toContain(data.spaces.get('Annex')!.id);
  });

  it('rejects stale duplicate decisions across same-role stages and supports revisions, rejection and rescheduling', async () => {
    const event = await createEvent('facultyCs', 'Iterative review and retry');
    const original = await submit('facultyCs', event.id, 'Repeated HOD', slot(40));
    const [first, duplicate] = await Promise.all([decide('hodMe', original), decide('hodMe', original)]);
    expect([first.statusCode, duplicate.statusCode].sort()).toEqual([200, 409]);
    expect([first, duplicate].find(({ statusCode }) => statusCode === 409)?.json().code).toBe('APPROVAL_STATE_CHANGED');
    let current = [first, duplicate].find(({ statusCode }) => statusCode === 200)!.json<RequestDetailView>().request;
    expect(current.currentStepOrder).toBe(2);
    for (const description of ['Updated equipment plan', 'Updated seating layout']) {
      const changes = await decide('hodMe', current, 'CHANGES_REQUESTED', 'Please revise the plan before approval.');
      expect(changes.statusCode, changes.body).toBe(200);
      expect((await decide('hodMe', current, 'CHANGES_REQUESTED', 'Please revise the plan before approval.')).statusCode).toBe(409);
      const revised = await api('PATCH', `/venue-requests/${original.id}`, 'facultyCs', { event: { description } });
      expect(revised.statusCode, revised.body).toBe(200);
      current = revised.json<RequestDetailView>().request;
    }
    const rejection = await decide('hodMe', current, 'REJECTED', 'The equipment is unavailable.');
    expect(rejection.statusCode, rejection.body).toBe(200);
    const rejected = rejection.json<RequestDetailView>();
    expect(rejected.request.status).toBe('REJECTED');
    expect(rejected.decisions.map(({ decision }) => decision)).toEqual(['APPROVED', 'CHANGES_REQUESTED', 'CHANGES_REQUESTED', 'REJECTED']);
    expect(await calendar(original.venue.id, slot(40))).toEqual([]);
    const moved = await submit('facultyCs', event.id, 'Bursar only', slot(41));
    expect((await final('bursar', moved)).statusCode).toBe(200);
  });
});
