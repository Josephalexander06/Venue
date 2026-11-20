import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  Clock,
  MapPin,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { ROLE_LABELS, WORKFLOW_SCOPE_LABELS } from '@venue/shared';
import { api } from '../lib/api';
import { usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import { formatTimeRange } from '../lib/datetime';
import {
  Alert,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../components/ui';
import { RequestStatusBadge } from '../components/booking';

export function ApprovalInboxPage() {
  usePageTitle('Approval inbox');
  const [filter, setFilter] = useState<'all' | 'conflicts'>('all');

  const inboxQuery = useQuery({
    queryKey: ['approvals', 'inbox'],
    queryFn: () => api.approvalInbox({ limit: 50 }),
    refetchInterval: 30_000,
  });

  const allItems = inboxQuery.data?.items ?? [];
  const filteredItems = allItems.filter((item) => {
    if (filter === 'conflicts') {
      return item.conflicts.confirmedCount > 0 || item.conflicts.pendingCount > 0;
    }
    return true;
  });

  const pendingCount = allItems.length;
  const conflictCount = allItems.filter(
    (i) => i.conflicts.confirmedCount > 0 || i.conflicts.pendingCount > 0,
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Workflow engine"
        title="Approval inbox"
        description="Booking requests awaiting your review and decision as an institutional approver."
        actions={
          <div className="inbox-stats-pills">
            <span className="inbox-stat-pill">
              <strong>{pendingCount}</strong> pending decision
            </span>
            {conflictCount > 0 && (
              <span className="inbox-stat-pill is-warning">
                <strong>{conflictCount}</strong> with overlaps
              </span>
            )}
          </div>
        }
      />

      {inboxQuery.isError && (
        <div className="page-alert">
          <Alert tone="danger" title="Could not load approval inbox">
            Please check your connection and{' '}
            <button
              type="button"
              className="inline-link"
              onClick={() => void inboxQuery.refetch()}
            >
              try again
            </button>
            .
          </Alert>
        </div>
      )}

      <div className="booking-filter-bar">
        <div className="filter-tabs" role="tablist" aria-label="Inbox filter">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`filter-tab ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All awaiting me ({pendingCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'conflicts'}
            className={`filter-tab ${filter === 'conflicts' ? 'is-active' : ''}`}
            onClick={() => setFilter('conflicts')}
          >
            With competing slots ({conflictCount})
          </button>
        </div>
        <span className="booking-filter-note">
          <Clock size={15} /> Approval stages are sequential; requests proceed as each approver decides.
        </span>
      </div>

      {inboxQuery.isPending ? (
        <div className="event-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="event-card">
              <Skeleton className="skeleton-line skeleton-line-wide" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-block" />
            </div>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CheckCircle size={32} weight="duotone" />}
            title={allItems.length === 0 ? 'Inbox zero!' : 'No matching requests'}
            description={
              allItems.length === 0
                ? 'You have reviewed all booking requests currently assigned to your role and department.'
                : 'Try switching filters to view all pending requests.'
            }
          />
        </div>
      ) : (
        <div className="inbox-list">
          {filteredItems.map((item) => (
            <article key={item.request.id} className="inbox-card">
              <div className="inbox-card-head">
                <div className="inbox-card-title-group">
                  <div className="inbox-card-badge-row">
                    <span className="inbox-step-badge">
                      Stage: {item.step.stepName} ({ROLE_LABELS[item.step.requiredRole]} · {WORKFLOW_SCOPE_LABELS[item.step.scopeType]})
                    </span>
                    <RequestStatusBadge status={item.request.status} />
                    {item.step.isFinalAllotmentStep && (
                      <span className="approval-final-badge">Final allotment stage</span>
                    )}
                  </div>
                  <h3 className="inbox-card-title">
                    <Link to={`/approvals/${item.request.id}`}>{item.event.title}</Link>
                  </h3>
                  {item.event.description && (
                    <p className="inbox-card-desc">{item.event.description}</p>
                  )}
                </div>

                <Link
                  to={`/approvals/${item.request.id}`}
                  className="btn btn-primary btn-md inbox-card-action"
                >
                  Review & decide
                </Link>
              </div>

              <div className="inbox-card-grid">
                <div className="inbox-grid-cell">
                  <span className="cell-label">Venue</span>
                  <strong>{item.request.venue.name}</strong>
                  <span className="cell-sub">
                    <MapPin size={14} /> {item.request.venue.building} · Floor {item.request.venue.floor}
                  </span>
                </div>

                <div className="inbox-grid-cell">
                  <span className="cell-label">Requested date & time</span>
                  <strong>{formatDate(item.request.startTime)}</strong>
                  <span className="cell-sub">
                    <Clock size={14} /> {formatTimeRange(item.request.startTime, item.request.endTime)}
                  </span>
                </div>

                <div className="inbox-grid-cell">
                  <span className="cell-label">Department & attendance</span>
                  <strong>{item.event.department.name}</strong>
                  <span className="cell-sub">
                    <UsersThree size={14} /> {item.event.expectedAttendance} attendees expected
                  </span>
                </div>

                <div className="inbox-grid-cell">
                  <span className="cell-label">Competitor status</span>
                  {item.conflicts.confirmedCount > 0 ? (
                    <span className="inbox-conflict-tag is-danger">
                      <WarningCircle size={14} weight="fill" /> {item.conflicts.confirmedCount} confirmed conflict
                    </span>
                  ) : item.conflicts.pendingCount > 0 ? (
                    <span className="inbox-conflict-tag is-warning">
                      <UsersThree size={14} /> {item.conflicts.pendingCount} competing request{item.conflicts.pendingCount > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="inbox-conflict-tag is-clean">
                      <CheckCircle size={14} weight="fill" /> Slot clear
                    </span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
