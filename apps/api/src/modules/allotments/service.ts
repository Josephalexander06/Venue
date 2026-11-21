import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AllotmentConfirmInput, RoleName, WorkflowScopeType } from '@venue/shared';
import type { Database } from '../../db/index.js';
import {
  approvalInstances,
  departments,
  events,
  users,
  venueAllotments,
  venueRequests,
  venues,
  workflowSteps,
} from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { bufferedRange } from '../../lib/booking.js';
import { AppError } from '../../lib/errors.js';
import { notifyRequestParticipants } from '../../lib/notifications.js';
import { eligibleForStep, loadViewerRoles } from '../approvals/eligibility.js';
import { isEventCollaborator } from '../events/service.js';
import { getRequestView } from '../requests/service.js';
import { mapRequestRow, requestSelection, type EventSummary } from '../requests/view.js';

interface Viewer {
  userId: string;
  isAdmin: boolean;
}

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AllotmentResult {
  allotmentId: string;
  status: 'ACTIVE';
  venueId: string;
  reservedRange: string;
  supersededRequestsCount: number;
  supersededRequestIds: string[];
}

export interface CancellationResult {
  success: boolean;
  allotmentId: string;
  status: 'CANCELLED';
  cancelledAt: string;
  releasedRange: string;
  affectedSupersededCount: number;
  affectedRequestIds: string[];
}

export interface CompetingRequestView {
  request: ReturnType<typeof mapRequestRow>;
  event: EventSummary;
  allotmentStep: {
    role: RoleName;
    scopeType: WorkflowScopeType;
  } | null;
  decisions: Array<{
    stepOrder: number;
    stepName: string;
    decision: string;
    remarks: string | null;
    approver: string;
  }>;
}

// Deadlock and serialization retry helper
async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: unknown) {
      attempt++;
      const err = error as { code?: string } | null;
      // 40P01 = deadlock_detected, 40001 = serialization_failure
      if ((err?.code === '40P01' || err?.code === '40001') && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 50) + 20 * attempt;
        await new Promise((resolve) => setTimeout(resolve, jitter));
        continue;
      }
      throw error;
    }
  }
  throw new AppError(500, 'TRANSACTION_RETRY_FAILED', 'Transaction failed after retries.');
}

export async function confirmAllotment(
  db: Database,
  viewer: Viewer,
  input: AllotmentConfirmInput,
  context: RequestContext,
): Promise<AllotmentResult> {
  return withRetry(async () => {
    return db.transaction(async (tx) => {
      // 1. Fetch request details to identify venue and event
      const [reqRow] = await tx
        .select({
          id: venueRequests.id,
          eventId: venueRequests.eventId,
          venueId: venueRequests.venueId,
          workflowId: venueRequests.workflowId,
          startTime: venueRequests.startTime,
          endTime: venueRequests.endTime,
          setupBufferMins: venueRequests.setupBufferMins,
          teardownBufferMins: venueRequests.teardownBufferMins,
          status: venueRequests.status,
          creatorId: events.creatorId,
          facultyCoordinatorId: events.facultyCoordinatorId,
          submittedById: venueRequests.submittedById,
          eventTitle: events.title,
          departmentId: events.departmentId,
          venueDepartmentId: venues.departmentId,
        })
        .from(venueRequests)
        .innerJoin(events, eq(events.id, venueRequests.eventId))
        .innerJoin(venues, eq(venues.id, venueRequests.venueId))
        .where(eq(venueRequests.id, input.venueRequestId));

      if (!reqRow) {
        throw new AppError(404, 'REQUEST_NOT_FOUND', 'Venue request not found.');
      }

      // Idempotency: if request is already confirmed with an active allotment, return existing record
      if (reqRow.status === 'CONFIRMED') {
        const [existing] = await tx
          .select({
            id: venueAllotments.id,
            status: venueAllotments.status,
            venueId: venueAllotments.venueId,
            reservedRange: sql<string>`${venueAllotments.reservedRange}::text`,
          })
          .from(venueAllotments)
          .where(
            and(
              eq(venueAllotments.venueRequestId, reqRow.id),
              eq(venueAllotments.status, 'ACTIVE'),
            ),
          );
        if (existing) {
          return {
            allotmentId: existing.id,
            status: 'ACTIVE',
            venueId: existing.venueId,
            reservedRange: existing.reservedRange,
            supersededRequestsCount: 0,
            supersededRequestIds: [],
          };
        }
      }

      // 2. Lock target venue row to serialize concurrent allotment attempts for this venue
      await tx.execute(sql`SELECT id FROM venues WHERE id = ${reqRow.venueId} FOR UPDATE`);

      // 3. Lock target request row
      const [lockedReq] = await tx
        .select()
        .from(venueRequests)
        .where(eq(venueRequests.id, input.venueRequestId))
        .for('update');

      if (!lockedReq) {
        throw new AppError(404, 'REQUEST_NOT_FOUND', 'Venue request not found.');
      }

      if (lockedReq.status === 'CONFIRMED') {
        const [existing] = await tx
          .select({
            id: venueAllotments.id,
            status: venueAllotments.status,
            venueId: venueAllotments.venueId,
            reservedRange: sql<string>`${venueAllotments.reservedRange}::text`,
          })
          .from(venueAllotments)
          .where(
            and(
              eq(venueAllotments.venueRequestId, lockedReq.id),
              eq(venueAllotments.status, 'ACTIVE'),
            ),
          );
        if (existing) {
          return {
            allotmentId: existing.id,
            status: 'ACTIVE',
            venueId: existing.venueId,
            reservedRange: existing.reservedRange,
            supersededRequestsCount: 0,
            supersededRequestIds: [],
          };
        }
      }

      if (lockedReq.status === 'SUPERSEDED_CONFLICT') {
        throw new AppError(
          409,
          'SLOT_ALREADY_ALLOTTED',
          'This request was superseded because the venue slot was allotted to another event.',
        );
      }

      if (lockedReq.status !== 'APPROVED_PENDING_ALLOTMENT') {
        throw new AppError(
          409,
          'REQUEST_NOT_READY_FOR_ALLOTMENT',
          'Only requests with completed preliminary approvals can receive final allotment.',
        );
      }

      // 4. Separation of duties: requester/collaborator/coordinator cannot allot their own request
      const isCollaborator = await isEventCollaborator(tx, reqRow.eventId, viewer.userId);
      if (
        reqRow.creatorId === viewer.userId ||
        reqRow.submittedById === viewer.userId ||
        reqRow.facultyCoordinatorId === viewer.userId ||
        isCollaborator
      ) {
        throw new AppError(
          403,
          'SELF_APPROVAL_FORBIDDEN',
          'Institutional policy prohibits self-allotment. Event organizers and coordinators cannot commit final allotment for their own event.',
        );
      }

      // 5. Verify final approver authority based on workflow definition
      const steps = await tx
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.workflowId, reqRow.workflowId))
        .orderBy(asc(workflowSteps.stepOrder));

      const finalStep =
        steps.find((s) => s.isFinalAllotmentStep) ?? steps[steps.length - 1];

      const viewerRoles = await loadViewerRoles(tx, viewer.userId);
      const isEligible = finalStep
        ? eligibleForStep(viewerRoles, finalStep, reqRow.departmentId, reqRow.venueDepartmentId)
        : viewer.isAdmin;

      if (!isEligible && !viewer.isAdmin) {
        throw new AppError(
          403,
          'ALLOTMENT_FORBIDDEN',
          'You are not authorized to confirm final allotment for this workflow.',
        );
      }

      // If an administrator is overriding an allotment step where they are not normally eligible, require remarks
      const normallyEligible = finalStep && eligibleForStep(
        viewerRoles, finalStep, reqRow.departmentId, reqRow.venueDepartmentId, false,
      );

      if (viewer.isAdmin && !normallyEligible) {
        if (!input.remarks || input.remarks.trim().length < 5) {
          throw new AppError(
            400,
            'OVERRIDE_REMARKS_REQUIRED',
            'Administrative override requires remarks explaining the decision (at least 5 characters).',
          );
        }
      }

      // 6. Compute effective buffer range
      const effective = bufferedRange(
        lockedReq.startTime,
        lockedReq.endTime,
        lockedReq.setupBufferMins,
        lockedReq.teardownBufferMins,
      );

      // 7. Verify no existing active allotment overlaps
      const [conflict] = await tx
        .select({
          id: venueAllotments.id,
          eventTitle: events.title,
          reservedRange: sql<string>`${venueAllotments.reservedRange}::text`,
        })
        .from(venueAllotments)
        .innerJoin(events, eq(events.id, venueAllotments.eventId))
        .where(
          and(
            eq(venueAllotments.venueId, lockedReq.venueId),
            eq(venueAllotments.status, 'ACTIVE'),
            ne(venueAllotments.venueRequestId, lockedReq.id),
            sql`${venueAllotments.reservedRange} && tstzrange(${effective.start.toISOString()}, ${effective.end.toISOString()}, '[)')`,
          ),
        )
        .limit(1);

      if (conflict) {
        throw new AppError(
          409,
          'SLOT_ALREADY_ALLOTTED',
          `The selected venue was allotted to another event ('${conflict.eventTitle}') during your review session.`,
        );
      }

      // 8. Insert new active allotment (protected by GiST exclusion constraint)
      let allotmentId: string;
      try {
        const [created] = await tx
          .insert(venueAllotments)
          .values({
            venueRequestId: lockedReq.id,
            venueId: lockedReq.venueId,
            eventId: lockedReq.eventId,
            reservedRange: sql`tstzrange(${effective.start.toISOString()}, ${effective.end.toISOString()}, '[)')`,
            status: 'ACTIVE',
            allottedBy: viewer.userId,
          })
          .returning({ id: venueAllotments.id });
        if (!created) throw new Error('Allotment insert returned no row.');
        allotmentId = created.id;
      } catch (err: unknown) {
        const pgErr = err as { code?: string } | null;
        if (pgErr?.code === '23P01') {
          throw new AppError(
            409,
            'SLOT_ALREADY_ALLOTTED',
            'The selected venue was allotted to another event during your review session.',
          );
        }
        throw err;
      }

      const now = new Date();

      // 9. Mark winning request as CONFIRMED
      await tx
        .update(venueRequests)
        .set({
          status: 'CONFIRMED',
          updatedAt: now,
        })
        .where(eq(venueRequests.id, lockedReq.id));

      // 10. Mark event as SUBMITTED (active confirmed booking)
      await tx
        .update(events)
        .set({
          status: 'SUBMITTED',
          updatedAt: now,
        })
        .where(eq(events.id, lockedReq.eventId));

      // 11. Conflict Resolution Policy Dispatcher: Supersede competing unresolved requests
      const supersededReason = `Slot allotted to another conflicting event ('${reqRow.eventTitle}'). Please reschedule.`;

      const supersededRows = await tx
        .update(venueRequests)
        .set({
          status: 'SUPERSEDED_CONFLICT',
          rejectionReason: supersededReason,
          updatedAt: now,
        })
        .where(
          and(
            eq(venueRequests.venueId, lockedReq.venueId),
            ne(venueRequests.id, lockedReq.id),
            inArray(venueRequests.status, [
              'SUBMITTED',
              'IN_REVIEW',
              'APPROVED_PENDING_ALLOTMENT',
            ]),
            sql`${venueRequests.effectiveRange} && tstzrange(${effective.start.toISOString()}, ${effective.end.toISOString()}, '[)')`,
          ),
        )
        .returning({ id: venueRequests.id, eventId: venueRequests.eventId });

      // Invalidate active approval instances for all superseded requests
      if (supersededRows.length > 0) {
        const supersededIds = supersededRows.map((r) => r.id);
        await tx
          .update(approvalInstances)
          .set({ isActive: false, updatedAt: now })
          .where(
            and(
              inArray(approvalInstances.venueRequestId, supersededIds),
              eq(approvalInstances.isActive, true),
            ),
          );

        // Audit log each superseded request
        for (const row of supersededRows) {
          await writeAudit(tx, {
            actorId: viewer.userId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            action: 'REQUEST_SUPERSEDED',
            entityName: 'venue_requests',
            entityId: row.id,
            oldState: { status: 'PENDING_APPROVAL' },
            newState: {
              status: 'SUPERSEDED_CONFLICT',
              reason: supersededReason,
              winningRequestId: lockedReq.id,
              allotmentId,
            },
          });
          await notifyRequestParticipants(tx, row.id, {
            type: 'REQUEST_SUPERSEDED',
            subject: 'Your venue request was superseded',
            body: `Another event was allotted the venue for your requested time. ${supersededReason}`,
            excludeUserId: viewer.userId,
            payload: { winningRequestId: lockedReq.id, allotmentId },
          });
        }
      }

      // 12. Write audit log for the allotment confirmation
      await writeAudit(tx, {
        actorId: viewer.userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        action: 'ALLOTMENT_CONFIRMED',
        entityName: 'venue_allotments',
        entityId: allotmentId,
        newState: {
          requestId: lockedReq.id,
          venueId: lockedReq.venueId,
          eventId: lockedReq.eventId,
          reservedRange: `["${effective.start.toISOString()}","${effective.end.toISOString()}")`,
          remarks: input.remarks ?? null,
          isAdministrativeOverride: viewer.isAdmin && !normallyEligible,
          supersededCount: supersededRows.length,
        },
      });

      await notifyRequestParticipants(tx, lockedReq.id, {
        type: 'ALLOTMENT_CONFIRMED',
        subject: `Venue confirmed: ${reqRow.eventTitle}`,
        body: `The venue for “${reqRow.eventTitle}” has been finally allotted. Your booking is confirmed.`,
        excludeUserId: viewer.userId,
        payload: { allotmentId, venueId: lockedReq.venueId },
      });

      return {
        allotmentId,
        status: 'ACTIVE',
        venueId: lockedReq.venueId,
        reservedRange: `["${effective.start.toISOString()}","${effective.end.toISOString()}")`,
        supersededRequestsCount: supersededRows.length,
        supersededRequestIds: supersededRows.map((r) => r.id),
      };
    });
  });
}

export async function cancelAllotment(
  db: Database,
  allotmentId: string,
  viewer: Viewer,
  reason: string,
  context: RequestContext,
): Promise<CancellationResult> {
  return db.transaction(async (tx) => {
    // 1. Lock and fetch allotment
    const [allotment] = await tx
      .select({
        id: venueAllotments.id,
        status: venueAllotments.status,
        venueId: venueAllotments.venueId,
        eventId: venueAllotments.eventId,
        venueRequestId: venueAllotments.venueRequestId,
        allottedBy: venueAllotments.allottedBy,
        reservedRange: sql<string>`${venueAllotments.reservedRange}::text`,
        creatorId: events.creatorId,
        eventTitle: events.title,
      })
      .from(venueAllotments)
      .innerJoin(events, eq(events.id, venueAllotments.eventId))
      .where(eq(venueAllotments.id, allotmentId))
      .for('update');

    if (!allotment) {
      throw new AppError(404, 'ALLOTMENT_NOT_FOUND', 'Venue allotment record not found.');
    }

    if (allotment.status !== 'ACTIVE') {
      throw new AppError(
        409,
        'ALLOTMENT_NOT_ACTIVE',
        'This allotment is already cancelled or released.',
      );
    }

    // 2. Authorization: Event creator, allotting approver, or administrator
    const isOwner = allotment.creatorId === viewer.userId;
    const isAllotter = allotment.allottedBy === viewer.userId;
    if (!isOwner && !isAllotter && !viewer.isAdmin) {
      throw new AppError(
        403,
        'ALLOTMENT_CANCEL_FORBIDDEN',
        'You are not authorized to cancel this confirmed booking.',
      );
    }

    const now = new Date();

    // 3. Mark allotment as CANCELLED (releases PostgreSQL GiST exclusion lock)
    await tx
      .update(venueAllotments)
      .set({
        status: 'CANCELLED',
        cancelledAt: now,
        cancellationReason: reason,
      })
      .where(eq(venueAllotments.id, allotmentId));

    // 4. Mark associated venue request as CANCELLED
    await tx
      .update(venueRequests)
      .set({
        status: 'CANCELLED',
        rejectionReason: `Allotment cancelled: ${reason}`,
        updatedAt: now,
      })
      .where(eq(venueRequests.id, allotment.venueRequestId));

    // 5. Invalidate active approval instance
    await tx
      .update(approvalInstances)
      .set({ isActive: false, updatedAt: now })
      .where(
        and(
          eq(approvalInstances.venueRequestId, allotment.venueRequestId),
          eq(approvalInstances.isActive, true),
        ),
      );

    // 6. Check if event has remaining open/confirmed requests
    const [remaining] = await tx
      .select({ id: venueRequests.id })
      .from(venueRequests)
      .where(
        and(
          eq(venueRequests.eventId, allotment.eventId),
          ne(venueRequests.id, allotment.venueRequestId),
          inArray(venueRequests.status, [
            'SUBMITTED',
            'IN_REVIEW',
            'APPROVED_PENDING_ALLOTMENT',
            'CONFIRMED',
          ]),
        ),
      )
      .limit(1);

    if (!remaining) {
      await tx
        .update(events)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(eq(events.id, allotment.eventId));
    }

    // 7. Find affected superseded requests that were previously blocked by this slot
    const affectedSuperseded = await tx
      .select({
        id: venueRequests.id,
        eventId: venueRequests.eventId,
        title: events.title,
        creatorId: events.creatorId,
      })
      .from(venueRequests)
      .innerJoin(events, eq(events.id, venueRequests.eventId))
      .where(
        and(
          eq(venueRequests.venueId, allotment.venueId),
          eq(venueRequests.status, 'SUPERSEDED_CONFLICT'),
          sql`${venueRequests.effectiveRange} && (${allotment.reservedRange})::tstzrange`,
        ),
      );

    // 8. Write audit trail
    await writeAudit(tx, {
      actorId: viewer.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      action: 'ALLOTMENT_CANCELLED',
      entityName: 'venue_allotments',
      entityId: allotmentId,
      oldState: { status: 'ACTIVE' },
      newState: {
        status: 'CANCELLED',
        reason,
        cancelledAt: now.toISOString(),
        affectedSupersededCount: affectedSuperseded.length,
      },
    });

    if (affectedSuperseded.length > 0) {
      await writeAudit(tx, {
        actorId: viewer.userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        action: 'SLOT_RELEASED_NOTICE',
        entityName: 'venues',
        entityId: allotment.venueId,
        newState: {
          releasedRange: allotment.reservedRange,
          affectedRequestIds: affectedSuperseded.map((r) => r.id),
        },
      });
    }

    await notifyRequestParticipants(tx, allotment.venueRequestId, {
      type: 'ALLOTMENT_CANCELLED',
      subject: `Venue booking cancelled: ${allotment.eventTitle}`,
      body: `The confirmed venue booking for “${allotment.eventTitle}” was cancelled. Reason: ${reason}`,
      excludeUserId: viewer.userId,
      payload: { allotmentId, reason },
    });

    return {
      success: true,
      allotmentId,
      status: 'CANCELLED',
      cancelledAt: now.toISOString(),
      releasedRange: allotment.reservedRange,
      affectedSupersededCount: affectedSuperseded.length,
      affectedRequestIds: affectedSuperseded.map((r) => r.id),
    };
  });
}

export async function getCompetingRequests(
  db: Database,
  requestId: string,
  viewer: Viewer,
) {
  // Reuse the request access rules so a request ID cannot expose another
  // organizer's competitors to any signed-in account.
  await getRequestView(db, requestId, viewer);

  const [targetReq] = await db
    .select({
      id: venueRequests.id,
      venueId: venueRequests.venueId,
      startTime: venueRequests.startTime,
      endTime: venueRequests.endTime,
      setupBufferMins: venueRequests.setupBufferMins,
      teardownBufferMins: venueRequests.teardownBufferMins,
      effectiveRange: sql<string>`${venueRequests.effectiveRange}::text`,
    })
    .from(venueRequests)
    .where(eq(venueRequests.id, requestId));

  if (!targetReq) {
    throw new AppError(404, 'REQUEST_NOT_FOUND', 'Venue request not found.');
  }

  const effective = bufferedRange(
    targetReq.startTime,
    targetReq.endTime,
    targetReq.setupBufferMins,
    targetReq.teardownBufferMins,
  );

  // Find all open requests for this venue overlapping effective range
  const rows = await db
    .select({
      ...requestSelection,
      creatorId: events.creatorId,
      title: events.title,
      description: events.description,
      expectedAttendance: events.expectedAttendance,
      eventStatus: events.status,
      eventCreatedAt: events.createdAt,
      eventUpdatedAt: events.updatedAt,
      departmentId: departments.id,
      departmentCode: departments.code,
      departmentName: departments.name,
      creatorFirstName: users.firstName,
      creatorLastName: users.lastName,
      creatorEmail: users.email,
    })
    .from(venueRequests)
    .innerJoin(venues, eq(venues.id, venueRequests.venueId))
    .innerJoin(events, eq(events.id, venueRequests.eventId))
    .innerJoin(departments, eq(departments.id, events.departmentId))
    .innerJoin(users, eq(users.id, events.creatorId))
    .where(
      and(
        eq(venueRequests.venueId, targetReq.venueId),
        ne(venueRequests.id, targetReq.id),
        inArray(venueRequests.status, [
          'SUBMITTED',
          'IN_REVIEW',
          'APPROVED_PENDING_ALLOTMENT',
        ]),
        sql`${venueRequests.effectiveRange} && tstzrange(${effective.start.toISOString()}, ${effective.end.toISOString()}, '[)')`,
      ),
    )
    .orderBy(asc(venueRequests.createdAt));

  return {
    targetRequestId: requestId,
    competingRequests: rows.map((r) => ({
      request: mapRequestRow(r),
      event: {
        id: r.eventId,
        title: r.title,
        description: r.description,
        expectedAttendance: r.expectedAttendance,
        status: r.eventStatus,
        department: { id: r.departmentId, code: r.departmentCode, name: r.departmentName },
        createdAt: r.eventCreatedAt.toISOString(),
        updatedAt: r.eventUpdatedAt.toISOString(),
      },
      organizer: {
        id: r.creatorId,
        firstName: r.creatorFirstName,
        lastName: r.creatorLastName,
        email: r.creatorEmail,
      },
    })),
  };
}
