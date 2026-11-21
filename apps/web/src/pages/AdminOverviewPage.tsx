import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarBlank, CheckCircle, UsersThree } from '@phosphor-icons/react';
import { usePageTitle } from '../auth';
import { RequestStatusBadge } from '../components/booking';
import { Alert, Avatar, Button, EmptyState, PageHeader, SelectField, Skeleton } from '../components/ui';
import { UserReviewDialog } from '../components/UserReviewDialog';
import { api, type UserView } from '../lib/api';
import { addDays, dateInputValue, formatTimeRange, startOfDay } from '../lib/datetime';
import { formatDate } from '../lib/format';

const METRICS = [
  { status: 'PENDING_APPROVAL', label: 'Awaiting review' },
  { status: 'ACTIVE', label: 'Active accounts' },
  { status: 'REJECTED', label: 'Rejected' },
  { status: 'SUSPENDED', label: 'Suspended' },
] as const;

export function AdminOverviewPage() {
  usePageTitle('Admin overview');
  const [reviewing, setReviewing] = useState<UserView | null>(null);

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: api.adminStats,
    staleTime: 15_000,
  });

  const inbox = useQuery({
    queryKey: ['approvals', 'inbox-preview'],
    queryFn: () => api.approvalInbox({ limit: 3 }),
    staleTime: 15_000,
  });

  const pending = stats.data?.recentPending ?? [];

  return (
    <>
      <PageHeader
        title="Administration overview"
        description="Review new accounts and monitor venue requests and campus reservations."
        actions={
          <Link to="/admin/users?status=PENDING_APPROVAL" className="btn btn-primary btn-md">
            <UsersThree size={17} aria-hidden="true" /> Review registrations
          </Link>
        }
      />

      {stats.isError && (
        <div className="page-alert">
          <Alert tone="danger" title="Could not load account statistics">
            <button type="button" className="inline-link" onClick={() => void stats.refetch()}>Try again</button>
          </Alert>
        </div>
      )}

      <div className="console-metrics" aria-label="User account totals">
        {METRICS.map(({ status, label }) => (
          <Link key={status} to={`/admin/users?status=${status}`}>
            <span>{label}</span>
            <strong>{stats.isPending ? <Skeleton className="skeleton-stat" /> : stats.data?.counts[status] ?? '—'}</strong>
          </Link>
        ))}
      </div>

      <div className="console-grid">
        <section className="card workspace-panel" aria-labelledby="pending-heading">
          <div className="card-head">
            <div>
              <h2 id="pending-heading">Recent registrations</h2>
              <p>Latest accounts awaiting verification.</p>
            </div>
            <Link to="/admin/users?status=PENDING_APPROVAL" className="text-link">
              View queue <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          {stats.isPending ? (
            <div className="workspace-loading" role="status">
              <span className="sr-only">Loading registrations</span>
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-line skeleton-line-wide" />
            </div>
          ) : stats.isError ? null : pending.length === 0 ? (
            <EmptyState icon={<CheckCircle size={24} />} title="Registrations up to date" description="New access requests appear here." />
          ) : (
            <ul className="review-list">
              {pending.map((pendingUser) => (
                <li className="review-row" key={pendingUser.id}>
                  <Avatar firstName={pendingUser.firstName} lastName={pendingUser.lastName} size="sm" />
                  <div className="review-row-copy">
                    <strong>{pendingUser.firstName} {pendingUser.lastName}</strong>
                    <span>{pendingUser.email}</span>
                    <span className="review-row-meta">{pendingUser.department.name} · {formatDate(pendingUser.createdAt)}</span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setReviewing(pendingUser)}>Review</Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card workspace-panel" aria-labelledby="booking-queue-heading">
          <div className="card-head">
            <div>
              <h2 id="booking-queue-heading">Venue requests</h2>
              <p>{inbox.data ? `${inbox.data.total} awaiting a decision` : 'Requests available for you to review.'}</p>
            </div>
            <Link className="text-link" to="/approvals">Open inbox <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
          {inbox.isPending ? (
            <div className="workspace-loading" role="status">
              <span className="sr-only">Loading approval queue</span>
              <Skeleton className="skeleton-line skeleton-line-wide" />
              <Skeleton className="skeleton-line" />
            </div>
          ) : inbox.isError ? (
            <Alert tone="danger" title="Could not load venue requests">
              <button className="inline-link" onClick={() => void inbox.refetch()}>Try again</button>
            </Alert>
          ) : inbox.data.items.length === 0 ? (
            <EmptyState icon={<CheckCircle size={24} />} title="No requests awaiting review" description="Requests appear here when they reach your queue." />
          ) : (
            <ul className="workspace-rows">
              {inbox.data.items.map(({ request, event, conflicts }) => (
                <li key={request.id}>
                  <Link to={`/approvals/${request.id}`}>
                    <span><strong>{event.title}</strong><span>{request.venue.name} · {formatDate(request.startTime)}</span></span>
                    {conflicts.confirmedCount > 0 || conflicts.pendingCount > 0
                      ? <span className="workspace-overlap">{conflicts.confirmedCount ? 'Confirmed overlap' : 'Competing request'}</span>
                      : <RequestStatusBadge status={request.status} />}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CampusSchedule />
      {reviewing && <UserReviewDialog user={reviewing} mode="review" onClose={() => setReviewing(null)} />}
    </>
  );
}

function CampusSchedule() {
  const [venueId, setVenueId] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const from = startOfDay(addDays(new Date(), weekOffset * 7));
  const to = addDays(from, 7);

  const venues = useQuery({
    queryKey: ['admin', 'schedule-venues'],
    queryFn: async () => {
      const first = await api.venues({ limit: 100, active: true });
      const all = [...first.venues];
      for (let offset = 100; offset < first.total; offset += 100) {
        const result = await api.venues({ limit: 100, offset, active: true });
        all.push(...result.venues);
      }
      return all;
    },
    staleTime: 60_000,
  });

  const selection = venues.data?.find((venue) => venue.id === venueId) ?? venues.data?.[0];
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const schedule = useQuery({
    queryKey: ['venue-calendar', selection?.id, fromIso, toIso],
    enabled: Boolean(selection),
    queryFn: () => api.venueCalendar(selection!.id, fromIso, toIso),
  });
  const entries = schedule.data?.entries ?? [];

  return (
    <section className="card workspace-panel console-schedule" aria-labelledby="schedule-heading">
      <div className="card-head">
        <div>
          <h2 id="schedule-heading">Campus schedule</h2>
          <p>{formatDate(from)} – {formatDate(addDays(to, -1))}</p>
        </div>
        {selection && (
          <Link className="text-link" to={`/venues/${selection.id}?date=${dateInputValue(from)}`}>
            Open calendar <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
      {venues.isError ? (
        <Alert tone="danger" title="Could not load venues">
          <button className="inline-link" onClick={() => void venues.refetch()}>Try again</button>
        </Alert>
      ) : venues.isPending ? (
        <div className="workspace-loading" role="status">Loading venues…</div>
      ) : !selection ? (
        <EmptyState icon={<CalendarBlank size={24} />} title="No active venues" description="Add a venue to see its schedule here." />
      ) : (
        <>
          <div className="schedule-toolbar">
            <SelectField label="Venue" value={selection.id} onChange={(event) => setVenueId(event.target.value)}>
              {venues.data.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </SelectField>
            <div className="pagination" role="group" aria-label="Schedule date range">
              <Button variant="secondary" size="sm" onClick={() => setWeekOffset(weekOffset - 1)}>Previous week</Button>
              <Button variant="secondary" size="sm" onClick={() => setWeekOffset(weekOffset + 1)}>Next week</Button>
            </div>
          </div>
          {schedule.isError ? (
            <Alert tone="danger" title="Could not load this schedule">
              <button className="inline-link" onClick={() => void schedule.refetch()}>Try again</button>
            </Alert>
          ) : schedule.isPending ? (
            <div className="workspace-loading" role="status">Loading schedule…</div>
          ) : entries.length === 0 ? (
            <p className="schedule-empty">No reservations or requests for this venue during these dates.</p>
          ) : (
            <ul className="workspace-rows">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Link to={`/approvals/${entry.requestId}`}>
                    <span><strong>{entry.title}</strong><span>{formatDate(entry.startTime)} · {formatTimeRange(entry.startTime, entry.endTime)}</span></span>
                    <RequestStatusBadge status={entry.status} />
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
