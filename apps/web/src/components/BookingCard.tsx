import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarBlank } from '@phosphor-icons/react';
import { DEFAULT_BOOKING_TITLE, REQUEST_STATUS_LABELS } from '@venue/shared';
import type { EventSummary, EventView, RequestView } from '../lib/api';
import { formatShortDay } from '../lib/datetime';
import { displaySlot } from '../lib/slot-schedule';

export function bookingEntries(events: EventView[] = []) {
  return events.flatMap((event) => event.requests.map((request) => ({ request, event })));
}

export function bookingPhase(request: RequestView, now = Date.now()): 'upcoming' | 'pending' | 'past' {
  if (new Date(request.endTime).getTime() <= now || ['REJECTED', 'SUPERSEDED_CONFLICT', 'CANCELLED'].includes(request.status)) return 'past';
  return request.status === 'CONFIRMED' ? 'upcoming' : 'pending';
}

export function BookingProgress({ request }: { request: RequestView }) {
  const progress = request.status === 'CONFIRMED' ? 5
    : request.status === 'APPROVED_PENDING_ALLOTMENT' ? 4
      : request.status === 'IN_REVIEW' ? (request.currentStepOrder > 1 ? 3 : 2) : 1;
  const closed = ['REJECTED', 'SUPERSEDED_CONFLICT', 'CANCELLED'].includes(request.status);
  const status = request.facultyEndorsedAt && request.status === 'IN_REVIEW' && progress === 2
    ? 'Endorsed' : REQUEST_STATUS_LABELS[request.status];
  return <div className={`booking-progress${closed ? ' progress-closed' : ''}`}>
    <span className="booking-progress-segments" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => (
      <i key={index} data-filled={index < progress} />
    ))}</span>
    <span>{status}</span>
  </div>;
}

export function BookingCard({ request, event }: { request: RequestView; event: EventSummary }) {
  return <article className="product-panel booking-card">
    <div className="booking-card-heading">
      <span className="product-icon"><CalendarBlank size={22} aria-hidden="true" /></span>
      <div>
        <h3><Link to={`/bookings/${request.id}`}>{request.venue.name}</Link></h3>
        <p>{formatShortDay(new Date(request.startTime))} · {displaySlot(request.startTime, request.endTime)}</p>
      </div>
      <Link className="product-icon-link" to={`/bookings/${request.id}`} aria-label={`View booking for ${request.venue.name}`}>
        <ArrowUpRight size={20} aria-hidden="true" />
      </Link>
    </div>
    {event.title !== DEFAULT_BOOKING_TITLE && <p className="booking-card-event">{event.title}</p>}
    <BookingProgress request={request} />
  </article>;
}
