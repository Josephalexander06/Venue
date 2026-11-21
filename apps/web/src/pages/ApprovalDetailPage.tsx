import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowClockwise,
  ArrowLeft,
  CalendarCheck,
  CheckCircle,
  Clock,
  MapPin,
  Prohibit,
  ShieldCheck,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { ROLE_LABELS, WORKFLOW_SCOPE_LABELS } from '@venue/shared';
import { api } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import { formatTimeRange } from '../lib/datetime';
import {
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
  const { isAdmin } = useAuth();
  const { pushToast } = useToast();

  const [showDecisionDialog, setShowDecisionDialog] = useState(false);
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
            <Link to="/approvals" className="btn btn-secondary btn-sm">
              <ArrowLeft size={16} /> Return to inbox
            </Link>
          }
        />
      </div>
    );
  }

  const { request, event, workflow, timeline, decisions, conflicts, permissions, allotment } = detail;
  const currentStep = timeline.find((s) => s.state === 'CURRENT');

  async function handleConfirmAllotment(remarks: string) {
    if (!id) return;
    try {
      const res = await api.confirmAllotment({
        venueRequestId: id,
        remarks,
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
      void requestQuery.refetch();
    } catch (err: unknown) {
      pushToast({
        tone: 'danger',
        title: 'Allotment failed',
        message: err instanceof Error ? err.message : 'Could not commit allotment.',
      });
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
      void requestQuery.refetch();
    } catch (err: unknown) {
      pushToast({
        tone: 'danger',
        title: 'Cancellation failed',
        message: err instanceof Error ? err.message : 'Could not cancel allotment.',
      });
      throw err;
    }
  }

  return (
    <>
      <div className="detail-breadcrumb">
        <Link to="/approvals" className="btn btn-ghost btn-sm">
          <ArrowLeft size={16} /> Back to inbox
        </Link>
      </div>

      <PageHeader
        eyebrow={`${event.department.name} · ${workflow.name}`}
        title={event.title}
        description={event.description ?? 'Booking request awaiting institutional review.'}
        actions={
          <div className="detail-header-actions">
            <RequestStatusBadge status={request.status} />
            {permissions.canDecide && (
              <Button
                variant="primary"
                size="md"
                onClick={() => setShowDecisionDialog(true)}
              >
                Record decision
              </Button>
            )}
            {permissions.canAllot && (
              <Button
                variant="primary"
                size="md"
                onClick={() => setShowAllotDialog(true)}
              >
                Confirm & Allot Venue
              </Button>
            )}
            {permissions.canCancelAllotment && allotment && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => setShowCancelDialog(true)}
              >
                Cancel Allotment
              </Button>
            )}
          </div>
        }
      />

      <div className="approval-detail-layout">
        <div className="approval-detail-main">
          {/* Confirmed Banner */}
          {request.status === 'CONFIRMED' && (
            <div className="allotment-confirmed-banner">
              <div className="confirmed-banner-header">
                <CheckCircle size={24} weight="fill" className="text-emerald" />
                <div>
                  <h4>Confirmed Venue Reservation</h4>
                  <p>
                    This venue is officially reserved and active on the master campus calendar.
                    {allotment?.allottedBy && (
                      <> Allotted by {allotment.allottedBy.firstName} {allotment.allottedBy.lastName} ({allotment.allottedBy.email}).</>
                    )}
                  </p>
                </div>
              </div>
              {permissions.canCancelAllotment && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowCancelDialog(true)}
                >
                  <Prohibit size={15} /> Cancel Booking & Release Slot
                </Button>
              )}
            </div>
          )}

          {/* Superseded Banner */}
          {request.status === 'SUPERSEDED_CONFLICT' && (
            <div className="allotment-superseded-banner">
              <div className="superseded-banner-header">
                <WarningCircle size={24} weight="fill" className="text-amber" />
                <div>
                  <h4>Booking Superseded by Conflicting Allotment</h4>
                  <p>
                    {request.rejectionReason || 'Another conflicting request was confirmed for this venue and time slot.'}
                  </p>
                </div>
              </div>
              <div className="superseded-banner-actions">
                <Link to="/my-events" className="btn btn-secondary btn-sm">
                  <ArrowClockwise size={15} /> Reschedule under My Events
                </Link>
              </div>
            </div>
          )}

          {/* Allotment Action Banner when ready for final allotment */}
          {permissions.canAllot && (
            <div className="approval-allotment-banner">
              <div className="decision-banner-copy">
                <h4>
                  <CalendarCheck size={22} weight="fill" /> Ready for final venue allotment
                </h4>
                <p>
                  All preliminary workflow approvals have completed. As the authorized decision-maker, you can now
                  confirm the reservation and commit the slot.
                </p>
              </div>
              <div className="decision-banner-buttons">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setShowAllotDialog(true)}
                >
                  Confirm & Allot Venue
                </Button>
              </div>
            </div>
          )}

          {/* Key Facts Summary */}
          <div className="approval-summary-card">
            <h3 className="section-title">Booking particulars</h3>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="summary-label">Venue</span>
                <strong>{request.venue.name}</strong>
                <span>
                  <MapPin size={14} /> {request.venue.building} · Floor {request.venue.floor}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Requested event slot</span>
                <strong>{formatDate(request.startTime)}</strong>
                <span>
                  <Clock size={14} /> {formatTimeRange(request.startTime, request.endTime)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Effective buffer range</span>
                <strong>{formatTimeRange(request.effectiveStart, request.effectiveEnd)}</strong>
                <span>
                  Setup: {request.setupBufferMins}m · Teardown: {request.teardownBufferMins}m
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Department & attendance</span>
                <strong>{event.department.name}</strong>
                <span>
                  <UsersThree size={14} /> {event.expectedAttendance} attendees expected
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Faculty oversight</span>
                {event.facultyCoordinator ? (
                  <>
                    <strong>
                      Prof. {event.facultyCoordinator.firstName} {event.facultyCoordinator.lastName}
                    </strong>
                    <span>{event.facultyCoordinator.email}</span>
                  </>
                ) : (
                  <>
                    <strong>Faculty submission</strong>
                    <span>Direct submission (no Stage 0 endorsement required)</span>
                  </>
                )}
              </div>
              {request.requiresFacultyEndorsement && (
                <div className="summary-item">
                  <span className="summary-label">Faculty endorsement</span>
                  {request.facultyEndorsedAt ? (
                    <>
                      <strong className="text-emerald">Endorsed</strong>
                      <span>Endorsement recorded on {formatDate(request.facultyEndorsedAt)}</span>
                    </>
                  ) : (
                    <>
                      <strong className="text-amber">Pending endorsement</strong>
                      <span>Stage 0 review awaiting designated coordinator</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Decision Action Banner if canDecide */}
          {permissions.canDecide && currentStep && (
            <div className="approval-decision-banner">
              <div className="decision-banner-copy">
                <h4>
                  <ShieldCheck size={20} weight="fill" /> Your decision is requested
                </h4>
                <p>
                  You are authorized to review this request for{' '}
                  <strong>{currentStep.stepName}</strong> ({ROLE_LABELS[currentStep.requiredRole]} ·{' '}
                  {WORKFLOW_SCOPE_LABELS[currentStep.scopeType]}).
                </p>
              </div>
              <div className="decision-banner-buttons">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setShowDecisionDialog(true)}
                >
                  Approve / Reject / Changes
                </Button>
              </div>
            </div>
          )}

          {/* Competitor Split Comparison (if competitors exist) */}
          {conflicts.pending.length > 0 && (
            <CompetitorComparison
              currentRequestId={request.id}
              conflicts={conflicts.pending}
              venueCapacity={0}
            />
          )}

          {/* Conflict Analysis */}
          <div className="approval-section-card">
            <h3 className="section-title">Conflict analysis</h3>
            <ConflictSummary conflicts={conflicts} />
          </div>

          {/* Workflow Timeline */}
          <div className="approval-section-card">
            <ApprovalTimeline
              timeline={timeline}
              decisions={decisions}
              currentRound={detail.currentRound}
              status={request.status}
            />
          </div>
        </div>

        {/* Sidebar Info */}
        <aside className="approval-detail-aside">
          <div className="card aside-panel">
            <h4>Workflow specification</h4>
            <p className="aside-sub">{workflow.name}</p>
            {workflow.description && <p className="aside-desc">{workflow.description}</p>}
            <ol className="aside-step-list">
              {workflow.steps.map((step) => (
                <li key={step.id} className="aside-step-item">
                  <span className="step-num">{step.stepOrder}</span>
                  <div>
                    <strong>{step.stepName}</strong>
                    <span>
                      {ROLE_LABELS[step.requiredRole]} · {WORKFLOW_SCOPE_LABELS[step.scopeType]}
                      {step.isFinalAllotmentStep && ' · Final Allotment'}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="card aside-panel">
            <h4>Institutional policy</h4>
            <ul className="aside-policy-list">
              <li>
                <strong>Separation of duties:</strong> Requesters cannot approve or allot their own bookings.
              </li>
              <li>
                <strong>Atomic allotment:</strong> Exactly one booking wins an overlapping slot. Competing
                requests are atomically superseded.
              </li>
              <li>
                <strong>GiST temporal protection:</strong> Double-bookings are mathematically blocked at the
                PostgreSQL engine level.
              </li>
              <li>
                <strong>Critical edits:</strong> Editing venue, date, or times invalidates prior approvals and
                restarts review.
              </li>
            </ul>
          </div>
        </aside>
      </div>

      {showDecisionDialog && currentStep && (
        <ApprovalDecisionDialog
          requestId={request.id}
          stepName={currentStep.stepName}
          onClose={() => setShowDecisionDialog(false)}
          onSuccess={() => void requestQuery.refetch()}
        />
      )}

      {showAllotDialog && (
        <AllotmentConfirmDialog
          open={showAllotDialog}
          onOpenChange={setShowAllotDialog}
          detail={detail}
          onConfirm={handleConfirmAllotment}
          isOverride={isAdmin}
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
