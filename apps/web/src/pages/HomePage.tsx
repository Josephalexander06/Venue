import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarBlank, ClipboardText } from '@phosphor-icons/react';
import { useAuth, usePageTitle } from '../auth';
import { APPROVAL_PREVIEW_KEY } from '../components/AppShell';
import { BookingCard, bookingEntries, bookingPhase } from '../components/BookingCard';
import { Alert, EmptyState, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { formatShortDay } from '../lib/datetime';

export function HomePage() {
  usePageTitle('Home');
  const { user, isApprover } = useAuth();
  const events = useQuery({ queryKey: ['my-events'], queryFn: api.myEvents });
  const inbox = useQuery({
    queryKey: APPROVAL_PREVIEW_KEY, queryFn: () => api.approvalInbox({ limit: 3 }),
    enabled: isApprover, staleTime: 15_000,
  });
  const upcoming = bookingEntries(events.data?.events)
    .filter(({ request }) => bookingPhase(request) !== 'past')
    .sort((a, b) => a.request.startTime.localeCompare(b.request.startTime)).slice(0, 3);

  return <div className="product-page home-page">
    <section className="product-hero home-hero">
      <div className="product-hero-copy">
        <p className="hero-label">Hi, {user?.firstName}</p>
        <h1>What are you planning?</h1>
        <p>Find an available space and send a booking request.</p>
        <Link to="/venues" className="btn btn-lg hero-button">
          <CalendarBlank size={20} aria-hidden="true" /> Book a venue <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </section>

    {isApprover && Boolean(inbox.data?.total) && <section className="product-section">
      <div className="product-heading-row"><h2>Action needed <span className="product-count">{inbox.data!.total}</span></h2>
        <Link className="text-link" to="/approvals">Approval inbox <ArrowRight size={17} /></Link>
      </div>
      <div className="product-grid">{inbox.data!.items.map(({ request, event, step }) => <article className="product-panel home-action" key={request.id}>
        <span className="product-icon"><ClipboardText size={22} aria-hidden="true" /></span>
        <div><strong>{event.title}</strong><p>{step.stepOrder === 0 ? 'Endorsement' : 'Review'} · {formatShortDay(new Date(request.startTime))}</p></div>
        <Link to={`/approvals/${request.id}`} className="btn btn-secondary btn-sm" aria-label={`Review ${event.title}`}>Review <ArrowRight size={16} /></Link>
      </article>)}</div>
    </section>}

    <section className="product-section">
      <div className="product-heading-row"><h2>Your upcoming bookings</h2>
        <Link className="text-link" to="/bookings">View all <ArrowRight size={17} /></Link>
      </div>
      {events.isError ? <Alert tone="danger" title="Could not load bookings">
        <button className="inline-link" type="button" onClick={() => void events.refetch()}>Try again</button>
      </Alert> : events.isPending ? <div className="product-grid" role="status">
        <span className="sr-only">Loading bookings</span><Skeleton className="skeleton-block" />
      </div> : !upcoming.length ? <div className="product-panel"><EmptyState icon={<CalendarBlank size={28} />}
        title="You have no upcoming bookings" /></div> : <div className="product-grid">
        {upcoming.map((entry) => <BookingCard key={entry.request.id} {...entry} />)}
      </div>}
    </section>
  </div>;
}
