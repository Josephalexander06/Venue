import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Clock,
  MapPin,
  ShieldCheck,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { ROLE_LABELS, WORKFLOW_SCOPE_LABELS } from '@venue/shared';
import { api } from '../lib/api';
import { usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import { formatTimeRange } from '../lib/datetime';
import {
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../components/ui';
import { RequestStatusBadge } from '../components/booking';
import { ApprovalTimeline } from '../components/approvals/ApprovalTimeline';
import { ApprovalDecisionDialog } from '../components/approvals/ApprovalDecisionDialog';
import { ConflictSummary } from '../components/approvals/ConflictSummary';

export function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  usePageTitle('Review booking request');
  const [showDecisionDialog, setShowDecisionDialog] = useState(false);

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

  const { request, event, workflow, timeline, decisions, conflicts, permissions } = detail;
  const currentStep = timeline.find((s) => s.state === 'CURRENT');

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
          </div>
        }
      />

      <div className="approval-detail-layout">
        <div className="approval-detail-main">
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
                <strong>Separation of duties:</strong> Requesters cannot approve their own bookings.
              </li>
              <li>
                <strong>Preliminary review:</strong> Single- and multi-step approvals progress requests to
                Approved Pending Allotment.
              </li>
              <li>
                <strong>Final allotment:</strong> Preliminary approval does not confirm a booking.
                Only final allotment reserves the slot.
              </li>
              <li>
                <strong>Critical edits:</strong> If the organizer edits the venue, date, or times, all
                earlier approvals are invalidated and the workflow restarts.
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
    </>
  );
}
