import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CheckCircle,
  Clock,
  MapPin,
  UsersThree,
} from '@phosphor-icons/react';
import { ROLE_LABELS, WORKFLOW_SCOPE_LABELS } from '@venue/shared';
import { api } from '../lib/api';
import { usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import { formatTimeRange } from '../lib/datetime';
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../components/ui';
import { RequestStatusBadge } from '../components/booking';

type InboxTab = 'all' | 'preliminary' | 'allotment' | 'conflicts';

const PAGE_SIZE = 10;

export function ApprovalInboxPage() {
  usePageTitle('Approval inbox');
  const [filter, setFilter] = useState<InboxTab>('all');
  const [offset, setOffset] = useState(0);

  const inboxQuery = useQuery({
    queryKey: ['approvals', 'inbox', offset],
    queryFn: () => api.approvalInbox({ limit: PAGE_SIZE, offset }),
    refetchInterval: 30_000,
  });

  const allItems = inboxQuery.data?.items ?? [];
  const total = inboxQuery.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function changeFilter(next: InboxTab) {
    setFilter(next);
    setOffset(0);
  }

  const preliminaryCount = allItems.filter(
    (i) => i.request.status === 'SUBMITTED' || i.request.status === 'IN_REVIEW',
  ).length;

  const allotmentCount = allItems.filter(
    (i) => i.request.status === 'APPROVED_PENDING_ALLOTMENT',
  ).length;

  const conflictCount = allItems.filter(
    (i) => i.conflicts.confirmedCount > 0 || i.conflicts.pendingCount > 0,
  ).length;

  const filteredItems = allItems.filter((item) => {
    if (filter === 'preliminary') {
      return item.request.status === 'SUBMITTED' || item.request.status === 'IN_REVIEW';
    }
    if (filter === 'allotment') {
      return item.request.status === 'APPROVED_PENDING_ALLOTMENT';
    }
    if (filter === 'conflicts') {
      return item.conflicts.confirmedCount > 0 || item.conflicts.pendingCount > 0;
    }
    return true;
  });

  return (
    <>
      <PageHeader
        eyebrow="Workflow engine"
        title="Approval inbox"
        description="Booking requests awaiting your review and decision as an institutional approver."
        actions={
          <div className="inbox-stats-pills">
            <span className="inbox-stat-pill">
              <strong>{total}</strong> total in queue
            </span>
            {allotmentCount > 0 && (
              <span className="inbox-stat-pill is-success">
                <strong>{allotmentCount}</strong> ready for allotment
              </span>
            )}
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

      {/* Filter Tabs */}
      <div className="inbox-tabs-row" role="tablist" aria-label="Inbox filters">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`inbox-tab ${filter === 'all' ? 'is-active' : ''}`}
          onClick={() => changeFilter('all')}
        >
          All items ({total})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'preliminary'}
          className={`inbox-tab ${filter === 'preliminary' ? 'is-active' : ''}`}
          onClick={() => changeFilter('preliminary')}
        >
          Preliminary review ({preliminaryCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'allotment'}
          className={`inbox-tab ${filter === 'allotment' ? 'is-active' : ''}`}
          onClick={() => changeFilter('allotment')}
        >
          Ready for allotment ({allotmentCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'conflicts'}
          className={`inbox-tab ${filter === 'conflicts' ? 'is-active' : ''}`}
          onClick={() => changeFilter('conflicts')}
        >
          With overlaps ({conflictCount})
        </button>
      </div>

      {inboxQuery.isPending ? (
        <div className="inbox-skeleton-list" aria-busy="true">
          <Skeleton className="skeleton-card" />
          <Skeleton className="skeleton-card" />
          <Skeleton className="skeleton-card" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CheckCircle size={36} weight="duotone" />}
            title={filter === 'all' ? 'Inbox is clear' : 'No matching requests'}
            description={
              filter === 'all'
                ? 'No venue booking requests are currently awaiting your decision. You will see requests here when organizer submissions reach your workflow step.'
                : 'No requests match this filter tab right now.'
            }
          />
        </div>
      ) : (
        <>
        <div className="inbox-list">
          {filteredItems.map((item) => {
            const isAllotment = item.request.status === 'APPROVED_PENDING_ALLOTMENT';

            return (
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
                    className={`btn ${isAllotment ? 'btn-accent' : 'btn-primary'} btn-md inbox-card-action`}
                  >
                    {isAllotment ? (
                      <>
                        <CalendarCheck size={16} /> Review & allot
                      </>
                    ) : (
                      'Review & decide'
                    )}
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
                    <span className="cell-label">Conflict status</span>
                    {item.conflicts.confirmedCount > 0 ? (
                      <span className="badge badge-danger">
                        {item.conflicts.confirmedCount} confirmed conflict
                      </span>
                    ) : item.conflicts.pendingCount > 0 ? (
                      <span className="badge badge-warning">
                        {item.conflicts.pendingCount} competing request{item.conflicts.pendingCount > 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="badge badge-success">Slot clear</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <footer className="table-foot">
          <p>
            Showing <strong>{total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE_SIZE, total)}</strong> of{' '}
            <strong>{total}</strong> requests
          </p>
          <div className="pagination">
            <Button
              variant="ghost"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              <ArrowLeft size={15} /> Previous
            </Button>
            <span className="page-indicator">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next <ArrowRight size={15} />
            </Button>
          </div>
        </footer>
        </>
      )}
    </>
  );
}
