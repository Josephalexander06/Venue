import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  CheckCircle,
  MagnifyingGlass,
  WarningCircle,
} from '@phosphor-icons/react';
import { ROLE_LABELS } from '@venue/shared';
import { useAuth, usePageTitle } from '../auth';
import { RequestStatusBadge } from '../components/booking';
import { Alert, Button, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { api, type ApprovalInboxItem } from '../lib/api';
import { formatTimeRange } from '../lib/datetime';
import { formatDate } from '../lib/format';

const FILTERS = [
  { id: 'all', label: 'All requests' },
  { id: 'review', label: 'In review' },
  { id: 'allotment', label: 'Ready to allot' },
  { id: 'conflicts', label: 'Overlaps' },
] as const;
type InboxFilter = (typeof FILTERS)[number]['id'];
type InboxSort = 'oldest' | 'newest' | 'upcoming';

const PAGE_SIZE = 10;
const BATCH_SIZE = 50;

function isReady(item: ApprovalInboxItem) {
  return item.request.status === 'APPROVED_PENDING_ALLOTMENT';
}

function hasOverlap(item: ApprovalInboxItem) {
  return item.conflicts.confirmedCount > 0 || item.conflicts.pendingCount > 0;
}

async function loadInbox(signal: AbortSignal) {
  // The API pages the role-scoped queue. Read each page so filters and counts cover the full queue.
  const first = await api.approvalInbox({ limit: BATCH_SIZE }, signal);
  const items = new Map(first.items.map((item) => [item.request.id, item]));
  for (let offset = BATCH_SIZE; offset < first.total; offset += BATCH_SIZE) {
    const batch = await api.approvalInbox({ limit: BATCH_SIZE, offset }, signal);
    for (const item of batch.items) items.set(item.request.id, item);
  }
  return [...items.values()];
}

export function ApprovalInboxPage() {
  const { isFacultyOnlyApprover: facultyOnly } = useAuth();
  const title = facultyOnly ? 'Faculty endorsements' : 'Approval inbox';
  usePageTitle(title);

  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<InboxSort>('oldest');
  const [pageIndex, setPageIndex] = useState(0);

  const inbox = useQuery({
    queryKey: ['approvals', 'inbox'],
    queryFn: ({ signal }) => loadInbox(signal),
    refetchInterval: 30_000,
  });

  const { counts, results } = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const counts: Record<InboxFilter, number> = { all: 0, review: 0, allotment: 0, conflicts: 0 };
    const results = (inbox.data ?? []).filter((item) => {
      const ready = isReady(item);
      const overlap = hasOverlap(item);
      counts.all++;
      counts[ready ? 'allotment' : 'review']++;
      if (overlap) counts.conflicts++;
      if (filter === 'review' && ready) return false;
      if (filter === 'allotment' && !ready) return false;
      if (filter === 'conflicts' && !overlap) return false;
      return !term || [
        item.event.title,
        item.event.department.name,
        item.event.department.code,
        item.request.venue.name,
      ].some((value) => value.toLocaleLowerCase().includes(term));
    });
    results.sort((a, b) => {
      if (sort === 'upcoming') return a.request.startTime.localeCompare(b.request.startTime);
      const bySubmission = a.request.createdAt.localeCompare(b.request.createdAt);
      return sort === 'newest' ? -bySubmission : bySubmission;
    });
    return { counts, results };
  }, [inbox.data, filter, search, sort]);

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const offset = page * PAGE_SIZE;
  const visible = results.slice(offset, offset + PAGE_SIZE);
  const isFiltered = filter !== 'all' || search.trim().length > 0;

  function clearFilters() {
    setFilter('all');
    setSearch('');
    setPageIndex(0);
  }

  return (
    <>
      <PageHeader
        title={title}
        description={facultyOnly
          ? 'Review student event requests that need your endorsement.'
          : 'Review venue requests, resolve scheduling overlaps and confirm allotments.'}
      />

      {inbox.isError && (
        <div className="page-alert">
          <Alert tone="danger" title={inbox.data ? 'Could not refresh the queue' : 'Could not load the queue'}>
            <button type="button" className="inline-link" onClick={() => void inbox.refetch()}>
              Try again
            </button>
          </Alert>
        </div>
      )}

      <section className="queue" aria-label={title} aria-busy={inbox.isPending}>
        <div className="queue-filters" role="group" aria-label="Filter requests">
          {FILTERS.filter(({ id }) => !facultyOnly || id !== 'allotment' || counts.allotment > 0 || filter === id).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="queue-filter"
              aria-pressed={filter === id}
              onClick={() => { setFilter(id); setPageIndex(0); }}
            >
              {label}{inbox.data && <span>{counts[id]}</span>}
            </button>
          ))}
        </div>

        <div className="queue-toolbar">
          <label className="search-field">
            <MagnifyingGlass size={17} className="search-icon" aria-hidden="true" />
            <span className="sr-only">Search event, venue or department</span>
            <input
              type="search"
              className="input search-input"
              value={search}
              placeholder="Search event, venue or department"
              onChange={(event) => { setSearch(event.target.value); setPageIndex(0); }}
            />
          </label>
          <label className="queue-sort">
            <span>Sort by</span>
            <select
              className="input"
              value={sort}
              onChange={(event) => { setSort(event.target.value as InboxSort); setPageIndex(0); }}
            >
              <option value="oldest">Oldest submitted</option>
              <option value="newest">Newest submitted</option>
              <option value="upcoming">Earliest event</option>
            </select>
          </label>
        </div>

        {inbox.isPending ? (
          <div className="table-skeleton" role="status">
            <span className="sr-only">Loading requests</span>
            {[1, 2, 3].map((row) => (
              <div className="table-skeleton-row" key={row} aria-hidden="true">
                <Skeleton className="skeleton-line" />
                <Skeleton className="skeleton-line" />
              </div>
            ))}
          </div>
        ) : inbox.data && visible.length === 0 ? (
          <EmptyState
            icon={<CheckCircle size={24} />}
            title={isFiltered ? 'No matching requests' : 'You’re caught up'}
            description={isFiltered
              ? 'Try a different search or clear the filters.'
              : 'Requests appear here when they reach a stage you can review.'}
            action={isFiltered && <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
          />
        ) : visible.length > 0 && (
          <>
            <table className="queue-table" role="table">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Venue & schedule</th>
                  <th scope="col">Review stage</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Open request</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.request.id}>
                    <th scope="row" className="queue-event">
                      <strong>{item.event.title}</strong>
                      <span className="queue-meta">
                        {item.event.department.name} · {item.event.expectedAttendance} attendees
                      </span>
                    </th>
                    <td className="queue-schedule">
                      <strong>{item.request.venue.name}</strong>
                      <span className="queue-meta">
                        {formatDate(item.request.startTime)} · {formatTimeRange(item.request.startTime, item.request.endTime)}
                      </span>
                    </td>
                    <td className="queue-stage">
                      <strong>{item.step.stepOrder === 0 ? 'Faculty endorsement' : item.step.stepName}</strong>
                      {item.step.stepOrder > 0 && <span className="queue-meta">{ROLE_LABELS[item.step.requiredRole]}</span>}
                    </td>
                    <td className="queue-status">
                      <RequestStatusBadge status={item.request.status} />
                      {item.conflicts.confirmedCount > 0 && (
                        <span className="queue-overlap is-confirmed">
                          <WarningCircle size={15} aria-hidden="true" /> Confirmed overlap
                        </span>
                      )}
                      {item.conflicts.pendingCount > 0 && (
                        <span className="queue-overlap">
                          <WarningCircle size={15} aria-hidden="true" /> {item.conflicts.pendingCount} competing
                        </span>
                      )}
                    </td>
                    <td className="queue-action">
                      <Link to={`/approvals/${item.request.id}`} className="btn btn-secondary btn-sm">
                        {isReady(item) ? 'Review & allot' : 'Review & decide'}
                        <span className="sr-only"> {item.event.title}</span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <footer className="table-foot">
              <p role="status">
                <strong>{offset + 1}–{offset + visible.length}</strong> of <strong>{results.length}</strong> requests
              </p>
              <nav className="pagination" aria-label="Request pages">
                <Button variant="secondary" size="sm" aria-label="Previous page" disabled={page === 0}
                  onClick={() => setPageIndex(page - 1)}>
                  <CaretLeft size={15} aria-hidden="true" />
                </Button>
                <span className="page-indicator">Page {page + 1} of {pageCount}</span>
                <Button variant="secondary" size="sm" aria-label="Next page" disabled={page + 1 >= pageCount}
                  onClick={() => setPageIndex(page + 1)}>
                  <CaretRight size={15} aria-hidden="true" />
                </Button>
              </nav>
            </footer>
          </>
        )}
      </section>
    </>
  );
}
