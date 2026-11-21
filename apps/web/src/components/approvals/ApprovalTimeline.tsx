import {
  CheckCircle,
  Clock,
  DotsThreeCircle,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { ROLE_LABELS, WORKFLOW_SCOPE_LABELS } from '@venue/shared';
import type { ApprovalDecisionView, ApprovalTimelineStep } from '../../lib/api';
import { formatDate } from '../../lib/format';

interface ApprovalTimelineProps {
  timeline: ApprovalTimelineStep[];
  decisions: ApprovalDecisionView[];
  currentRound?: number | null;
  status: string;
}

export function ApprovalTimeline({
  timeline,
  decisions,
  currentRound,
  status,
}: ApprovalTimelineProps) {
  const previousRoundDecisions = decisions.filter((d) => !d.isCurrentRound);

  return (
    <div className="approval-timeline-wrapper">
      <div className="approval-timeline-head">
        <h4>Approval workflow</h4>
        {currentRound && currentRound > 1 && (
          <span className="approval-round-badge">Review round {currentRound}</span>
        )}
      </div>

      <ol className="approval-timeline-steps">
        {timeline.map((step) => {
          const isDone = step.state === 'APPROVED';
          const isRejected = step.state === 'REJECTED';
          const isChanges = step.state === 'CHANGES_REQUESTED';
          const isCurrent = step.state === 'CURRENT';
          const isPending = step.state === 'PENDING';

          let stateClass = 'is-pending';
          if (isDone) stateClass = 'is-approved';
          else if (isRejected) stateClass = 'is-rejected';
          else if (isChanges) stateClass = 'is-changes';
          else if (isCurrent) stateClass = 'is-current';

          return (
            <li key={step.id} className={`approval-timeline-node ${stateClass}`}>
              <div className="approval-timeline-marker" aria-hidden="true">
                {isDone ? (
                  <CheckCircle size={22} weight="fill" />
                ) : isRejected ? (
                  <XCircle size={22} weight="fill" />
                ) : isChanges ? (
                  <WarningCircle size={22} weight="fill" />
                ) : isCurrent ? (
                  <span className="approval-current-dot" />
                ) : (
                  <span className="approval-step-num">{step.stepOrder}</span>
                )}
              </div>

              <div className="approval-timeline-content">
                <div className="approval-timeline-title-row">
                  <span className="approval-step-name">{step.stepName}</span>
                  <span className="approval-role-badge">
                    {ROLE_LABELS[step.requiredRole]} · {WORKFLOW_SCOPE_LABELS[step.scopeType]}
                  </span>
                  {step.stepOrder === 0 && (
                    <span className="approval-endorsement-badge">Preliminary endorsement</span>
                  )}
                  {step.isFinalAllotmentStep && (
                    <span className="approval-final-badge">Final allotment</span>
                  )}
                </div>

                {step.decision && (
                  <div className="approval-decision-record">
                    <p className="approval-decision-byline">
                      <strong>
                        {step.decision.decision === 'APPROVED'
                          ? 'Approved'
                          : step.decision.decision === 'REJECTED'
                            ? 'Rejected'
                            : 'Changes requested'}
                      </strong>{' '}
                      by {step.decision.approver.firstName} {step.decision.approver.lastName} on{' '}
                      {formatDate(step.decision.decidedAt)}
                    </p>
                    {step.decision.remarks && (
                      <blockquote className="approval-decision-remarks">
                        &ldquo;{step.decision.remarks}&rdquo;
                      </blockquote>
                    )}
                  </div>
                )}

                {isCurrent && (
                  <p className="approval-timeline-status-note">
                    <Clock size={15} /> Awaiting decision from {ROLE_LABELS[step.requiredRole]}
                  </p>
                )}

                {isPending && !step.decision && (
                  <p className="approval-timeline-status-muted">
                    <DotsThreeCircle size={15} /> Pending completion of prior steps
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {status === 'APPROVED_PENDING_ALLOTMENT' && (
        <div className="approval-pending-allotment-banner">
          <CheckCircle size={20} weight="fill" />
          <div>
            <strong>Preliminary approvals complete</strong>
            <p>
              All workflow approvals have been granted. The booking is awaiting final venue allotment.
            </p>
          </div>
        </div>
      )}

      {previousRoundDecisions.length > 0 && (
        <details className="approval-history-collapsible">
          <summary>View earlier review history ({previousRoundDecisions.length} decision{previousRoundDecisions.length > 1 ? 's' : ''})</summary>
          <ul className="approval-history-list">
            {previousRoundDecisions.map((decision) => (
              <li key={decision.id} className="approval-history-item">
                <div className="approval-history-header">
                  <span className="approval-round-label">Round {decision.round}</span>
                  <span className="approval-step-name">{decision.stepName}</span>
                  <span className={`status-pill ${decision.decision.toLowerCase()}`}>
                    {decision.decision}
                  </span>
                </div>
                <p className="approval-history-meta">
                  Decided by {decision.approver.firstName} {decision.approver.lastName} on{' '}
                  {formatDate(decision.decidedAt)}
                </p>
                {decision.remarks && (
                  <blockquote className="approval-decision-remarks">
                    &ldquo;{decision.remarks}&rdquo;
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
