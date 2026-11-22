import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck, WarningCircle } from '@phosphor-icons/react';
import { ROLE_LABELS, WORKFLOW_SCOPE_LABELS } from '@venue/shared';
import { api, ApiError } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import { formatTimeRange } from '../lib/datetime';
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';
import { RequestStatusBadge } from '../components/booking';
import { ApprovalTimeline } from '../components/approvals/ApprovalTimeline';
import { ApprovalDecisionDialog } from '../components/approvals/ApprovalDecisionDialog';
import { AllotmentConfirmDialog } from '../components/approvals/AllotmentConfirmDialog';
import { AllotmentCancelDialog } from '../components/approvals/AllotmentCancelDialog';
import { ConflictSummary } from '../components/approvals/ConflictSummary';
import { CompetitorComparison } from '../components/approvals/CompetitorComparison';

export function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  usePageTitle('Review booking request');
  const { isApprover } = useAuth();
  const queryClient = useQueryClient();
  const returnTo = isApprover ? '/approvals' : '/my-events';
  const { pushToast } = useToast();

  const [decisionReview, setDecisionReview] = useState<{
    requestId: string;
    updatedAt: string;
    stepName: string;
    allowApproval: boolean;
  } | null>(null);
  const [showAllotDialog, setShowAllotDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const requestQuery = useQuery({
    queryKey: ['approval', id],
    queryFn: () => (id ? api.approvalDetail(id) : null),
    enabled: Boolean(id),
  });

  const detail = requestQuery.data;

  if (requestQuery.isPending) {
    return (
      <div className="approval-detail-loading" aria-busy="true">
        <Skeleton className="skeleton-line skeleton-line-wide" />
        <Skeleton className="skeleton-block" />
        <Skeleton className="skeleton-block" />
      </div>
    );
  }

  if (requestQuery.isError || !detail) {
    return (
      <div className="card">
        <EmptyState
          icon={<WarningCircle size={32} weight="duotone" />}
          title="Request not found"
          description="This booking request may have been removed or you do not have permission to review it."
          action={
            <Link to={returnTo} className="btn btn-secondary btn-sm">
              <ArrowLeft size={16} aria-hidden="true" /> {isApprover ? 'Return to inbox' : 'Return to My events'}
            </Link>
          }
        />
      </div>
    );
  }

  const { request, event, workflow, timeline, decisions, conflicts, permissions, allotment } = detail;
  const currentStep = timeline.find((s) => s.stepOrder === request.currentStepOrder);

  async function refreshBooking() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['approval', id] }),
      queryClient.invalidateQueries({ queryKey: ['approvals'] }),
      queryClient.invalidateQueries({ queryKey: ['my-events'] }),
      queryClient.invalidateQueries({ queryKey: ['venue-calendar'] }),
      queryClient.invalidateQueries({ queryKey: ['venue-availability'] }),
    ]);
  }

  async function handleConfirmAllotment(remarks: string) {
    if (!id) return;
    try {
      const review = {
        remarks,
        expectedUpdatedAt: request.updatedAt,
        reviewedCompetingRequestIds: conflicts.pending.map((conflict) => conflict.requestId),
      };
      const res = permissions.canApproveAndAllot ? await api.approveAndAllot(id, review) : await api.confirmAllotment({
        ...review,
        venueRequestId: id,
        conflictResolutionPolicy: 'AUTO_REJECT_CONFLICTS',
      });
      pushToast({
        tone: 'success',
        title: 'Venue allotted successfully',
        message: `Reservation confirmed for ${request.venue.name}.${
          res.supersededRequestsCount > 0
            ? ` ${res.supersededRequestsCount} competing requests marked as superseded.`
            : ''
        }`,
      });
      await refreshBooking();
    } catch (err: unknown) {
      if (err instanceof ApiError && ['APPROVAL_STATE_CHANGED', 'COMPETING_REQUESTS_CHANGED', 'SLOT_ALREADY_ALLOTTED'].includes(err.code)) {
        await requestQuery.refetch();
      }
      throw err;
    }
  }

  async function handleCancelAllotment(reason: string) {
    if (!allotment?.id) return;
    try {
      await api.cancelAllotment(allotment.id, { reason });
      pushToast({
        tone: 'info',
        title: 'Allotment cancelled',
        message: 'The slot has been released on the public campus calendar.',
      });
      await refreshBooking();
    } catch (err: unknown) {
      pushToast({
        tone: 'danger',
        title: 'Cancellation failed',
        message: err instanceof Error ? err.message : 'Could not cancel allotment.',
      });
      throw err;
    }
  }

  const canDecide = permissions.canDecide && Boolean(currentStep);
  const canApproveAndAllot = permissions.canApproveAndAllot;
  const confirmed = request.status === 'CONFIRMED';
  const superseded = request.status === 'SUPERSEDED_CONFLICT';

  return (
    <>
      <div className="detail-breadcrumb">
        <Link to={returnTo} className="text-link">
          <ArrowLeft size={16} aria-hidden="true" /> {isApprover ? 'Back to inbox' : 'Back to My events'}
        </Link>
      </div>

      <PageHeader
        title={event.title}
        description={`${event.department.name} · ${workflow.name}`}
        actions={
          <>
            <RequestStatusBadge status={request.status} />
            {canDecide && (
              <Button
                variant={canApproveAndAllot ? 'secondary' : 'primary'}
                onClick={() => currentStep && setDecisionReview({
                  requestId: request.id,
                  updatedAt: request.updatedAt,
                  stepName: currentStep.stepName,
                  allowApproval: !canApproveAndAllot,
                })}
              >
                {canApproveAndAllot ? 'Reject or request changes' : 'Record decision'}
              </Button>
            )}
            {(canApproveAndAllot || permissions.canAllot) && (
              <Button onClick={() => setShowAllotDialog(true)}>
                <CalendarCheck size={17} aria-hidden="true" /> {canApproveAndAllot ? 'Approve & Allot Venue' : 'Allot Venue'}
              </Button>
            )}
            {permissions.canCancelAllotment && allotment && (
              <Button variant="secondary" onClick={() => setShowCancelDialog(true)}>Cancel allotment</Button>
            )}
          </>
        }
      />

      <div className="approval-detail-layout">
        <div className="approval-detail-main">
          {canDecide && currentStep && (
            <Alert tone="info" title="Decision requested">
              {currentStep.stepName}
              {currentStep.stepOrder !== 0 && ` (${ROLE_LABELS[currentStep.requiredRole]} · ${WORKFLOW_SCOPE_LABELS[currentStep.scopeType]})`}
            </Alert>
          )}
          {permissions.canAllot && (
            <Alert tone="success" title="Ready for final venue allotment">
              Review the schedule and any overlaps before confirming the reservation.
            </Alert>
          )}
          {confirmed && (
            <Alert tone="success" title="Confirmed Venue Reservation">
              {allotment?.allottedBy
                ? `Allotted by ${allotment.allottedBy.firstName} ${allotment.allottedBy.lastName} on ${formatDate(allotment.createdAt)}.`
                : 'The reservation is on the campus calendar.'}
            </Alert>
          )}
          {superseded && (
            <Alert tone="warning" title="Slot allotted to another event">
              {request.rejectionReason || 'A competing request was confirmed for this time.'}
              {' '}<Link to="/my-events" className="inline-link">Go to My events</Link>
            </Alert>
          )}
          {request.status === 'REJECTED' && request.rejectionReason && (
            <Alert tone="danger" title="Request declined">{request.rejectionReason}</Alert>
          )}
          {request.status === 'CANCELLED' && allotment?.cancellationReason && (
            <Alert tone="info" title="Reservation cancelled">{allotment.cancellationReason}</Alert>
          )}

          <section className="card booking-particulars" aria-labelledby="booking-particulars-heading">
            <div className="card-head">
              <div>
                <h2 id="booking-particulars-heading">Booking details</h2>
                {event.description && <p>{event.description}</p>}
              </div>
            </div>
            <dl className="summary-grid">
              <div className="summary-item">
                <dt className="summary-label">Venue</dt>
                <dd>
                  <strong>{request.venue.name}</strong>
                  <span>{request.venue.building} · {request.venue.floor === 0 ? 'Ground floor' : `Floor ${request.venue.floor}`}</span>
                </dd>
              </div>
              <div className="summary-item">
                <dt className="summary-label">Event schedule</dt>
                <dd>
                  <strong>{formatDate(request.startTime)}</strong>
                  <span>{formatTimeRange(request.startTime, request.endTime)}</span>
                </dd>
              </div>
              <div className="summary-item">
                <dt className="summary-label">Window including buffers</dt>
                <dd>
                  <strong>{formatTimeRange(request.effectiveStart, request.effectiveEnd)}</strong>
                  <span>{request.setupBufferMins} min setup · {request.teardownBufferMins} min cleanup</span>
                </dd>
              </div>
              <div className="summary-item">
                <dt className="summary-label">Attendance</dt>
                <dd><strong>{event.expectedAttendance} expected</strong><span>{request.venue.capacity} seats</span></dd>
              </div>
              {event.facultyCoordinator && (
                <div className="summary-item">
                  <dt className="summary-label">Faculty coordinator</dt>
                  <dd>
                    <strong>{event.facultyCoordinator.firstName} {event.facultyCoordinator.lastName}</strong>
                    <span>{event.facultyCoordinator.email}</span>
                  </dd>
                </div>
              )}
              {request.requiresFacultyEndorsement && (
                <div className="summary-item">
                  <dt className="summary-label">Endorsement</dt>
                  <dd><strong>{request.facultyEndorsedAt ? 'Endorsed' : 'Awaiting endorsement'}</strong>
                    {request.facultyEndorsedAt && <span>{formatDate(request.facultyEndorsedAt)}</span>}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {conflicts.pending.length > 0 && <CompetitorComparison detail={detail} canReadOrganizer={isApprover} />}
          {conflicts.confirmed.length > 0 && (
            <section className="card booking-particulars" aria-label="Confirmed scheduling conflicts">
              <ConflictSummary conflicts={{ confirmed: conflicts.confirmed, pending: [] }} />
            </section>
          )}
          {conflicts.confirmed.length === 0 && conflicts.pending.length === 0 && (
            <p className="booking-conflict-clear">No scheduling overlaps for this slot.</p>
          )}
        </div>

        <aside className="approval-detail-aside" aria-label="Approval history">
          <section className="card approval-history-panel">
            <ApprovalTimeline timeline={timeline} decisions={decisions} currentRound={detail.currentRound} status={request.status} />
          </section>
          {workflow.description && (
            <details className="card workflow-disclosure">
              <summary>About this workflow</summary>
              <p>{workflow.description}</p>
            </details>
          )}
        </aside>
      </div>

      {decisionReview?.requestId === request.id && (
        <ApprovalDecisionDialog
          {...decisionReview}
          onClose={() => setDecisionReview(null)}
          onSuccess={() => void requestQuery.refetch()}
        />
      )}

      {showAllotDialog && (
        <AllotmentConfirmDialog
          open={showAllotDialog}
          onOpenChange={setShowAllotDialog}
          detail={detail}
          onConfirm={handleConfirmAllotment}
          action={canApproveAndAllot ? 'Approve & Allot Venue' : 'Allot Venue'}
          unavailable={!canApproveAndAllot && !permissions.canAllot}
          isOverride={permissions.requiresAllotmentRemarks}
        />
      )}

      {showCancelDialog && (
        <AllotmentCancelDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          detail={detail}
          onConfirm={handleCancelAllotment}
        />
      )}
    </>
  );
}
