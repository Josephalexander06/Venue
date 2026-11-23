import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarBlank } from '@phosphor-icons/react';
import { usePageTitle } from '../auth';
import { BookingCard, bookingEntries, bookingPhase } from '../components/BookingCard';
import { Alert, EmptyState, Skeleton } from '../components/ui';
import { api } from '../lib/api';

const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'pending', label: 'Pending' },
  { id: 'past', label: 'Past' },
] as const;

export function MyBookingsPage() {
  usePageTitle('My bookings');
  const [selected, setSelected] = useState<(typeof TABS)[number]['id']>();
  const bookings = useQuery({ queryKey: ['my-events'], queryFn: api.myEvents });
  const entries = bookingEntries(bookings.data?.events);
  const phase = selected ?? (entries.some(({ request }) => bookingPhase(request) === 'upcoming') ? 'upcoming'
    : entries.some(({ request }) => bookingPhase(request) === 'pending') ? 'pending' : 'upcoming');
  const visible = entries.filter(({ request }) => bookingPhase(request) === phase).sort((a, b) => phase === 'past'
    ? b.request.startTime.localeCompare(a.request.startTime) : a.request.startTime.localeCompare(b.request.startTime));

  return <div className="product-page bookings-page">
    <div className="product-page-heading"><div><h1>My bookings</h1><p>Track your venue requests and reservations.</p></div>
      <Link to="/venues" className="btn btn-primary btn-lg">Book a venue <ArrowRight size={18} /></Link>
    </div>
    <div className="product-chips" aria-label="Filter bookings">
      {TABS.map(({ id, label }) => <button type="button" key={id} aria-pressed={phase === id} onClick={() => setSelected(id)}>{label}</button>)}
    </div>
    {bookings.isError ? <Alert tone="danger" title="Could not load your bookings">
      <button type="button" className="inline-link" onClick={() => void bookings.refetch()}>Try again</button>
    </Alert> : bookings.isPending ? <div className="product-grid" role="status">
      <span className="sr-only">Loading bookings</span><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" />
    </div> : !visible.length ? <div className="product-panel"><EmptyState icon={<CalendarBlank size={28} />}
      title={phase === 'past' ? 'No past bookings' : phase === 'pending' ? 'No pending requests' : 'No upcoming reservations'} /></div>
      : <div className="product-grid">{visible.map((entry) => <BookingCard key={entry.request.id} {...entry} />)}</div>}
    <Link className="text-link" to="/bookings/events">Manage event drafts and teams <ArrowRight size={16} /></Link>
  </div>;
}
