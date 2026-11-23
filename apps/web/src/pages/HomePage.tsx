import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Buildings,
  CalendarBlank,
  ChalkboardTeacher,
  CheckSquareOffset,
  Desktop,
  Plus,
  Sparkle,
} from '@phosphor-icons/react';
import type { RoleName } from '@venue/shared';
import { useAuth, usePageTitle } from '../auth';
import { RequestStatusBadge } from '../components/booking';
import { Alert, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { formatTimeRange } from '../lib/datetime';
import { formatDate, greeting, todayLabel } from '../lib/format';

const REVIEW_FOCUS = {
  HOD: 'Review departmental requests and check the schedule before endorsing a booking.',
  PRINCIPAL: 'Review requests routed to the Principal and inspect any competing bookings before deciding.',
  BURSAR: 'Review requests routed to the Bursar and check venue and schedule details before deciding.',
  FACULTY: 'Coordinate your events and endorse requests for the student events you supervise.',
} satisfies Partial<Record<RoleName, string>>;

export function HomePage() {
  usePageTitle('Home');
  const { user, isAdmin, isApprover, isFacultyOnlyApprover, hasRole } = useAuth();

  const queue = useQuery({
    queryKey: ['approvals', 'inbox-preview'],
    queryFn: () => api.approvalInbox({ limit: 3 }),
    enabled: isApprover && !isAdmin,
    staleTime: 15_000,
  });

  const events = useQuery({
    queryKey: ['my-events'],
    queryFn: api.myEvents,
    enabled: !isAdmin,
  });

  if (!user) return null;
  if (isAdmin) return <Navigate to="/admin" replace />;

  const focus = (['PRINCIPAL', 'BURSAR', 'HOD', 'FACULTY'] as const).find(hasRole);
  const recent = events.data?.events.filter((event) => event.status !== 'CANCELLED').slice(0, 5) ?? [];
  const inboxLabel = isFacultyOnlyApprover ? 'Endorsements' : 'Requests awaiting review';
  const eventList = (
    <section className="card workspace-panel" aria-labelledby="home-events">
      <div className="card-head">
        <div>
          <h2 id="home-events">{isApprover ? 'Your events' : 'Recent events'}</h2>
          <p>{isApprover ? 'Events you lead, coordinate or help organize.' : 'Follow booking progress and pick up your drafts.'}</p>
        </div>
        <Link to="/my-events" className="text-link">View all <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
      {events.isPending ? (
        <HomeRowsLoading label="Loading events" />
      ) : events.isError ? (
        <Alert tone="danger" title="Could not load events">
          <button className="inline-link" onClick={() => void events.refetch()}>Try again</button>
        </Alert>
      ) : recent.length === 0 ? (
        <EmptyState
          icon={<CalendarBlank size={24} />}
          title="No active events"
          description="Create an event to start planning, or browse venues to choose a slot first."
        />
      ) : (
        <ul className="workspace-rows">
          {recent.map((event) => {
            const request = event.requests[0];
            return (
              <li key={event.id}>
                <Link to={request ? `/my-events?highlight=${request.id}#event-${event.id}` : `/my-events#event-${event.id}`}>
                  <span>
                    <strong>{event.title}</strong>
                    <span>{request ? `${request.venue.name} · ${formatDate(request.startTime)}` : 'Venue selection needed'}</span>
                  </span>
                  {request ? <RequestStatusBadge status={request.status} /> : <span>Draft</span>}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <>
      <PageHeader
        eyebrow={todayLabel()}
        title={`${greeting()}, ${user.firstName}`}
        description={focus ? REVIEW_FOCUS[focus] : 'Find a campus venue, plan an event and track your booking requests.'}
        actions={
          <>
            <Link to="/my-events?create=1" className="btn btn-secondary btn-md">
              <Plus size={17} aria-hidden="true" /> Create event
            </Link>
            <Link to={isApprover ? '/approvals' : '/venues'} className="btn btn-primary btn-md">
              {isFacultyOnlyApprover ? 'Review endorsements' : isApprover ? 'Review requests' : 'Browse campus venues'}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </>
        }
      />

      {/* Quick Booking Categories (Booking platform style) */}
      <section className="home-quick-booking" aria-label="Quick category discovery">
        <h2 className="sr-only">Venue Categories</h2>
        <div className="home-category-grid">
          <Link to="/venues?facility=stage" className="home-category-card">
            <span className="home-category-icon is-auditorium">
              <Buildings size={22} />
            </span>
            <strong>Auditoriums</strong>
            <span>Grand halls & stages</span>
          </Link>
          <Link to="/venues?facility=projector" className="home-category-card">
            <span className="home-category-icon is-seminar">
              <ChalkboardTeacher size={22} />
            </span>
            <strong>Seminar Halls</strong>
            <span>Presentations & talks</span>
          </Link>
          <Link to="/venues?facility=wifi" className="home-category-card">
            <span className="home-category-icon is-lab">
              <Desktop size={22} />
            </span>
            <strong>Computer Labs</strong>
            <span>Workshops & hackathons</span>
          </Link>
          <Link to="/venues?facility=ac" className="home-category-card">
            <span className="home-category-icon is-conference">
              <Sparkle size={22} />
            </span>
            <strong>Conference Rooms</strong>
            <span>Meetings & discussions</span>
          </Link>
        </div>
      </section>

      <div className={isApprover ? 'workspace-grid' : 'workspace-grid workspace-grid-single'}>
        {isApprover && (
          <section className="card workspace-panel" aria-labelledby="home-queue">
            <div className="card-head">
              <div>
                <h2 id="home-queue">{inboxLabel}</h2>
                {queue.data && <p>{queue.data.total} awaiting a decision</p>}
              </div>
              <Link to="/approvals" className="text-link">Open inbox <ArrowRight size={15} aria-hidden="true" /></Link>
            </div>
            {queue.isPending ? (
              <HomeRowsLoading label="Loading requests" />
            ) : queue.isError ? (
              <Alert tone="danger" title="Could not load the approval queue">
                <button className="inline-link" onClick={() => void queue.refetch()}>Try again</button>
              </Alert>
            ) : queue.data.items.length === 0 ? (
              <EmptyState
                icon={<CheckSquareOffset size={24} />}
                title="You’re caught up"
                description="Requests will appear when they reach a stage you can review."
              />
            ) : (
              <ul className="workspace-rows">
                {queue.data.items.map(({ event, request, step, conflicts }) => (
                  <li key={request.id}>
                    <Link to={`/approvals/${request.id}`}>
                      <span>
                        <strong>{event.title}</strong>
                        <span>{request.venue.name} · {formatDate(request.startTime)} · {formatTimeRange(request.startTime, request.endTime)}</span>
                      </span>
                      <span className={conflicts.confirmedCount || conflicts.pendingCount ? 'workspace-overlap' : undefined}>
                        {conflicts.confirmedCount ? 'Confirmed overlap' : conflicts.pendingCount ? 'Competing request' : step.stepOrder === 0 ? 'Endorsement' : step.stepName}
                      </span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {eventList}
      </div>
    </>
  );
}

function HomeRowsLoading({ label }: { label: string }) {
  return (
    <div className="table-skeleton" role="status">
      <span className="sr-only">{label}</span>
      {[1, 2].map((row) => (
        <div className="table-skeleton-row" key={row} aria-hidden="true">
          <Skeleton className="skeleton-line" />
          <Skeleton className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}
