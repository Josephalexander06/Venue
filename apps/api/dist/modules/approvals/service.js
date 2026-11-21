import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { approvalDecisions, approvalInstances, departments, eventOrganizers, events, venueRequests, venues, workflowSteps, } from '../../db/schema.js';
import { isEventCollaborator } from '../events/service.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { notifyRequestParticipants } from '../../lib/notifications.js';
import { findRequestConflicts, getRequestView, } from '../requests/service.js';
import { mapRequestRow, requestSelection, } from '../requests/view.js';
import { eligibleForStep, loadViewerRoles, } from './eligibility.js';
const DECIDABLE_STATUSES = ['SUBMITTED', 'IN_REVIEW'];
const INBOX_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT'];
function eventSummary(row) {
    return {
        id: row.eventId,
        title: row.title,
        description: row.description,
        expectedAttendance: row.expectedAttendance,
        status: row.eventStatus,
        department: {
            id: row.departmentId,
            code: row.departmentCode,
            name: row.departmentName,
        },
        facultyCoordinatorId: row.facultyCoordinatorId,
        creatorId: row.creatorId,
        createdAt: row.eventCreatedAt.toISOString(),
        updatedAt: row.eventUpdatedAt.toISOString(),
    };
}
export async function listApprovalInbox(db, viewer, page) {
    const viewerRoles = await loadViewerRoles(db, viewer.userId);
    // 1. Query workflow step requests (Stage 1..N)
    const workflowRows = await db
        .select({
        ...requestSelection,
        creatorId: events.creatorId,
        facultyCoordinatorId: events.facultyCoordinatorId,
        title: events.title,
        description: events.description,
        expectedAttendance: events.expectedAttendance,
        eventStatus: events.status,
        eventCreatedAt: events.createdAt,
        eventUpdatedAt: events.updatedAt,
        departmentId: departments.id,
        departmentCode: departments.code,
        departmentName: departments.name,
        venueDepartmentId: venues.departmentId,
        stepId: workflowSteps.id,
        stepName: workflowSteps.stepName,
        requiredRole: workflowSteps.requiredRole,
        scopeType: workflowSteps.scopeType,
        isFinalAllotmentStep: workflowSteps.isFinalAllotmentStep,
    })
        .from(venueRequests)
        .innerJoin(venues, eq(venues.id, venueRequests.venueId))
        .innerJoin(events, eq(events.id, venueRequests.eventId))
        .innerJoin(departments, eq(departments.id, events.departmentId))
        .innerJoin(approvalInstances, and(eq(approvalInstances.venueRequestId, venueRequests.id), eq(approvalInstances.workflowId, venueRequests.workflowId), eq(approvalInstances.isActive, true)))
        .innerJoin(workflowSteps, and(eq(workflowSteps.workflowId, venueRequests.workflowId), eq(workflowSteps.stepOrder, venueRequests.currentStepOrder), eq(workflowSteps.stepOrder, approvalInstances.currentStepOrder)))
        .where(and(inArray(venueRequests.status, [...INBOX_STATUSES]), gt(venueRequests.currentStepOrder, 0)));
    const orgRows = await db
        .select({ eventId: eventOrganizers.eventId })
        .from(eventOrganizers)
        .where(eq(eventOrganizers.userId, viewer.userId));
    const orgEventIds = new Set(orgRows.map((r) => r.eventId));
    const eligibleWorkflowRows = workflowRows.filter((row) => row.creatorId !== viewer.userId &&
        row.submittedById !== viewer.userId &&
        row.facultyCoordinatorId !== viewer.userId &&
        !orgEventIds.has(row.eventId) &&
        eligibleForStep(viewerRoles, { requiredRole: row.requiredRole, scopeType: row.scopeType }, row.departmentId, row.venueDepartmentId));
    // 2. Query Step 0 requests (Faculty coordinator endorsement)
    const step0Rows = await db
        .select({
        ...requestSelection,
        creatorId: events.creatorId,
        facultyCoordinatorId: events.facultyCoordinatorId,
        title: events.title,
        description: events.description,
        expectedAttendance: events.expectedAttendance,
        eventStatus: events.status,
        eventCreatedAt: events.createdAt,
        eventUpdatedAt: events.updatedAt,
        departmentId: departments.id,
        departmentCode: departments.code,
        departmentName: departments.name,
        venueDepartmentId: venues.departmentId,
    })
        .from(venueRequests)
        .innerJoin(venues, eq(venues.id, venueRequests.venueId))
        .innerJoin(events, eq(events.id, venueRequests.eventId))
        .innerJoin(departments, eq(departments.id, events.departmentId))
        .innerJoin(approvalInstances, and(eq(approvalInstances.venueRequestId, venueRequests.id), eq(approvalInstances.workflowId, venueRequests.workflowId), eq(approvalInstances.isActive, true), eq(approvalInstances.currentStepOrder, 0)))
        .where(and(eq(venueRequests.currentStepOrder, 0), eq(venueRequests.requiresFacultyEndorsement, true), inArray(venueRequests.status, ['SUBMITTED', 'IN_REVIEW'])));
    const eligibleStep0Rows = step0Rows
        .filter((row) => {
        if (row.creatorId === viewer.userId || row.submittedById === viewer.userId) {
            return false;
        }
        return viewer.isAdmin || row.facultyCoordinatorId === viewer.userId;
    })
        .map((row) => ({
        ...row,
        stepId: 'faculty-endorsement',
        stepName: 'Faculty Coordinator Endorsement',
        requiredRole: 'FACULTY',
        scopeType: 'CREATOR_DEPARTMENT',
        isFinalAllotmentStep: false,
    }));
    const combined = [...eligibleStep0Rows, ...eligibleWorkflowRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const pageRows = combined.slice(page.offset, page.offset + page.limit);
    const items = await Promise.all(pageRows.map(async (row) => {
        const conflicts = await findRequestConflicts(db, {
            venueId: row.venueId,
            startTime: row.startTime,
            endTime: row.endTime,
            setupBufferMins: row.setupBufferMins,
            teardownBufferMins: row.teardownBufferMins,
            excludeRequestId: row.id,
        });
        return {
            request: mapRequestRow(row),
            event: eventSummary(row),
            step: {
                id: row.stepId,
                stepOrder: row.currentStepOrder,
                stepName: row.stepName,
                requiredRole: row.requiredRole,
                scopeType: row.scopeType,
                isFinalAllotmentStep: row.isFinalAllotmentStep,
            },
            conflicts: {
                confirmedCount: conflicts.confirmed.length,
                pendingCount: conflicts.pending.length,
            },
        };
    }));
    return {
        items,
        total: combined.length,
        limit: page.limit,
        offset: page.offset,
    };
}
export async function getApprovalDetail(db, requestId, viewer) {
    return getRequestView(db, requestId, viewer);
}
async function loadLockedRequest(db, requestId) {
    const [request] = await db
        .select()
        .from(venueRequests)
        .where(eq(venueRequests.id, requestId))
        .for('update')
        .limit(1);
    if (!request) {
        throw new AppError(404, 'REQUEST_NOT_FOUND', 'Booking request not found.');
    }
    const [event] = await db
        .select({
        id: events.id,
        creatorId: events.creatorId,
        facultyCoordinatorId: events.facultyCoordinatorId,
        departmentId: events.departmentId,
        title: events.title,
        status: events.status,
    })
        .from(events)
        .where(eq(events.id, request.eventId))
        .limit(1);
    const [venue] = await db
        .select({
        id: venues.id,
        name: venues.name,
        departmentId: venues.departmentId,
    })
        .from(venues)
        .where(eq(venues.id, request.venueId))
        .limit(1);
    if (!event || !venue) {
        throw new AppError(409, 'REQUEST_DATA_INCOMPLETE', 'This request is missing venue or event data.');
    }
    return { request, event, venue };
}
export async function decideRequest(db, requestId, viewer, input, context) {
    const outcome = await db.transaction(async (tx) => {
        const { request, event, venue } = await loadLockedRequest(tx, requestId);
        if (!DECIDABLE_STATUSES.includes(request.status)) {
            throw new AppError(409, 'REQUEST_NOT_IN_REVIEW', 'This request is no longer waiting for a preliminary decision.');
        }
        const [instance] = await tx
            .select()
            .from(approvalInstances)
            .where(and(eq(approvalInstances.venueRequestId, requestId), eq(approvalInstances.isActive, true)))
            .for('update')
            .limit(1);
        if (!instance) {
            throw new AppError(409, 'NO_ACTIVE_APPROVAL', 'This request has no active approval round.');
        }
        if (instance.workflowId !== request.workflowId ||
            instance.currentStepOrder !== request.currentStepOrder) {
            throw new AppError(409, 'APPROVAL_STATE_CHANGED', 'The approval state changed. Refresh the request and try again.');
        }
        if (event.creatorId === viewer.userId || request.submittedById === viewer.userId) {
            throw new AppError(403, 'SELF_APPROVAL_FORBIDDEN', 'You cannot approve or reject your own request.');
        }
        const now = new Date();
        let nextStatus = request.status;
        if (request.currentStepOrder === 0) {
            // Step 0: Faculty Coordinator Endorsement
            if (!viewer.isAdmin && event.facultyCoordinatorId !== viewer.userId) {
                throw new AppError(403, 'APPROVAL_FORBIDDEN', 'You are not the designated faculty coordinator for this event.');
            }
            if (input.decision !== 'CHANGES_REQUESTED') {
                const [existingDecision] = await tx
                    .select({ id: approvalDecisions.id, decision: approvalDecisions.decision })
                    .from(approvalDecisions)
                    .where(and(eq(approvalDecisions.approvalInstanceId, instance.id), eq(approvalDecisions.stepOrder, 0), eq(approvalDecisions.decision, input.decision)))
                    .limit(1);
                if (existingDecision) {
                    throw new AppError(409, 'DUPLICATE_DECISION', 'That decision has already been recorded for this stage.');
                }
            }
            await tx.insert(approvalDecisions).values({
                approvalInstanceId: instance.id,
                workflowStepId: null,
                stepOrder: 0,
                stepName: 'Faculty Coordinator Endorsement',
                approverId: viewer.userId,
                decision: input.decision,
                remarks: input.comments || null,
                decidedAt: now,
            });
            if (input.decision === 'REJECTED') {
                await tx
                    .update(approvalInstances)
                    .set({ isActive: false, isCompleted: true, updatedAt: now })
                    .where(eq(approvalInstances.id, instance.id));
                await tx
                    .update(venueRequests)
                    .set({
                    status: 'REJECTED',
                    rejectionReason: input.comments || null,
                    updatedAt: now,
                })
                    .where(eq(venueRequests.id, requestId));
                nextStatus = 'REJECTED';
            }
            else if (input.decision === 'CHANGES_REQUESTED') {
                await tx
                    .update(venueRequests)
                    .set({ status: 'SUBMITTED', rejectionReason: null, updatedAt: now })
                    .where(eq(venueRequests.id, requestId));
                nextStatus = 'SUBMITTED';
            }
            else {
                // APPROVED (Endorsed): Advance to venue workflow (Step 1)
                const steps = await tx
                    .select({ stepOrder: workflowSteps.stepOrder })
                    .from(workflowSteps)
                    .where(eq(workflowSteps.workflowId, request.workflowId))
                    .orderBy(asc(workflowSteps.stepOrder))
                    .limit(1);
                const firstWorkflowStep = steps[0];
                if (firstWorkflowStep) {
                    await tx
                        .update(approvalInstances)
                        .set({ currentStepOrder: firstWorkflowStep.stepOrder, updatedAt: now })
                        .where(eq(approvalInstances.id, instance.id));
                    await tx
                        .update(venueRequests)
                        .set({
                        status: 'IN_REVIEW',
                        currentStepOrder: firstWorkflowStep.stepOrder,
                        facultyEndorserId: viewer.userId,
                        facultyEndorsedAt: now,
                        rejectionReason: null,
                        updatedAt: now,
                    })
                        .where(eq(venueRequests.id, requestId));
                    nextStatus = 'IN_REVIEW';
                }
                else {
                    await tx
                        .update(approvalInstances)
                        .set({ isActive: false, isCompleted: true, updatedAt: now })
                        .where(eq(approvalInstances.id, instance.id));
                    await tx
                        .update(venueRequests)
                        .set({
                        status: 'APPROVED_PENDING_ALLOTMENT',
                        facultyEndorserId: viewer.userId,
                        facultyEndorsedAt: now,
                        rejectionReason: null,
                        updatedAt: now,
                    })
                        .where(eq(venueRequests.id, requestId));
                    nextStatus = 'APPROVED_PENDING_ALLOTMENT';
                }
            }
        }
        else {
            // Step 1..N: Configured venue workflow steps
            const [step] = await tx
                .select()
                .from(workflowSteps)
                .where(and(eq(workflowSteps.workflowId, request.workflowId), eq(workflowSteps.stepOrder, request.currentStepOrder)))
                .limit(1);
            if (!step) {
                throw new AppError(409, 'APPROVAL_STEP_MISSING', 'The current approval step is not configured.');
            }
            const viewerRoles = await loadViewerRoles(tx, viewer.userId);
            if (!eligibleForStep(viewerRoles, { requiredRole: step.requiredRole, scopeType: step.scopeType }, event.departmentId, venue.departmentId)) {
                throw new AppError(403, 'APPROVAL_FORBIDDEN', 'You are not the authorized approver for this stage.');
            }
            const isCollaborator = await isEventCollaborator(tx, event.id, viewer.userId);
            if (event.facultyCoordinatorId === viewer.userId || isCollaborator) {
                throw new AppError(403, 'SELF_APPROVAL_FORBIDDEN', 'Event organizers and coordinators cannot approve or reject their own event.');
            }
            if (input.decision !== 'CHANGES_REQUESTED') {
                const [existingDecision] = await tx
                    .select({ id: approvalDecisions.id, decision: approvalDecisions.decision })
                    .from(approvalDecisions)
                    .where(and(eq(approvalDecisions.approvalInstanceId, instance.id), eq(approvalDecisions.stepOrder, step.stepOrder), eq(approvalDecisions.decision, input.decision)))
                    .limit(1);
                if (existingDecision) {
                    throw new AppError(409, 'DUPLICATE_DECISION', 'That decision has already been recorded for this stage.');
                }
            }
            await tx.insert(approvalDecisions).values({
                approvalInstanceId: instance.id,
                workflowStepId: step.id,
                stepOrder: step.stepOrder,
                stepName: step.stepName,
                approverId: viewer.userId,
                decision: input.decision,
                remarks: input.comments || null,
                decidedAt: now,
            });
            if (input.decision === 'REJECTED') {
                await tx
                    .update(approvalInstances)
                    .set({ isActive: false, isCompleted: true, updatedAt: now })
                    .where(eq(approvalInstances.id, instance.id));
                await tx
                    .update(venueRequests)
                    .set({
                    status: 'REJECTED',
                    rejectionReason: input.comments || null,
                    updatedAt: now,
                })
                    .where(eq(venueRequests.id, requestId));
                nextStatus = 'REJECTED';
            }
            else if (input.decision === 'CHANGES_REQUESTED') {
                await tx
                    .update(venueRequests)
                    .set({ status: 'SUBMITTED', rejectionReason: null, updatedAt: now })
                    .where(eq(venueRequests.id, requestId));
                nextStatus = 'SUBMITTED';
            }
            else {
                const [nextStep] = await tx
                    .select({ stepOrder: workflowSteps.stepOrder })
                    .from(workflowSteps)
                    .where(and(eq(workflowSteps.workflowId, request.workflowId), gt(workflowSteps.stepOrder, step.stepOrder)))
                    .orderBy(asc(workflowSteps.stepOrder))
                    .limit(1);
                if (nextStep) {
                    await tx
                        .update(approvalInstances)
                        .set({ currentStepOrder: nextStep.stepOrder, updatedAt: now })
                        .where(eq(approvalInstances.id, instance.id));
                    await tx
                        .update(venueRequests)
                        .set({
                        status: 'IN_REVIEW',
                        currentStepOrder: nextStep.stepOrder,
                        rejectionReason: null,
                        updatedAt: now,
                    })
                        .where(eq(venueRequests.id, requestId));
                    nextStatus = 'IN_REVIEW';
                }
                else {
                    await tx
                        .update(approvalInstances)
                        .set({ isActive: false, isCompleted: true, updatedAt: now })
                        .where(eq(approvalInstances.id, instance.id));
                    await tx
                        .update(venueRequests)
                        .set({
                        status: 'APPROVED_PENDING_ALLOTMENT',
                        rejectionReason: null,
                        updatedAt: now,
                    })
                        .where(eq(venueRequests.id, requestId));
                    nextStatus = 'APPROVED_PENDING_ALLOTMENT';
                }
            }
        }
        await writeAudit(tx, {
            actorId: viewer.userId,
            action: input.decision === 'APPROVED'
                ? request.currentStepOrder === 0
                    ? 'FACULTY_ENDORSEMENT_APPROVED'
                    : 'APPROVAL_APPROVED'
                : input.decision === 'REJECTED'
                    ? request.currentStepOrder === 0
                        ? 'FACULTY_ENDORSEMENT_REJECTED'
                        : 'APPROVAL_REJECTED'
                    : request.currentStepOrder === 0
                        ? 'FACULTY_ENDORSEMENT_CHANGES_REQUESTED'
                        : 'APPROVAL_CHANGES_REQUESTED',
            entityName: 'venue_requests',
            entityId: requestId,
            oldState: {
                status: request.status,
                currentStepOrder: request.currentStepOrder,
            },
            newState: {
                status: nextStatus,
                currentStepOrder: request.currentStepOrder,
                decision: input.decision,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        await notifyRequestParticipants(tx, requestId, {
            type: `APPROVAL_${input.decision}`,
            subject: `Approval update: ${event.title}`,
            body: input.decision === 'APPROVED'
                ? `Your venue request for “${event.title}” passed ${request.currentStepOrder === 0 ? 'faculty endorsement' : 'an approval stage'}.`
                : input.decision === 'REJECTED'
                    ? `Your venue request for “${event.title}” was rejected. ${input.comments ?? ''}`.trim()
                    : `Changes were requested for “${event.title}”. ${input.comments ?? ''}`.trim(),
            excludeUserId: viewer.userId,
            payload: { decision: input.decision, status: nextStatus },
        });
        return { status: nextStatus, finalised: nextStatus === 'APPROVED_PENDING_ALLOTMENT' };
    });
    return {
        ...(await getRequestView(db, requestId, viewer)),
        outcome,
    };
}
//# sourceMappingURL=service.js.map