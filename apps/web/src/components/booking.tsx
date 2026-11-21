import { Link } from 'react-router-dom';
import { ArrowRight, MapPin, UsersThree } from '@phosphor-icons/react';
import {
  EVENT_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  type EventStatus,
  type RequestStatus,
} from '@venue/shared';
import type { Venue } from '../lib/api';

const REQUEST_TONES: Record<RequestStatus, string> = {
  SUBMITTED: 'pending',
  IN_REVIEW: 'pending',
  APPROVED_PENDING_ALLOTMENT: 'approved',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  SUPERSEDED_CONFLICT: 'superseded',
  CANCELLED: 'cancelled',
};

const EVENT_TONES: Record<EventStatus, string> = {
  DRAFT: 'draft',
  SUBMITTED: 'pending',
  CANCELLED: 'cancelled',
  COMPLETED: 'confirmed',
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`request-status request-status-${REQUEST_TONES[status]}`}>
      <span className="request-status-dot" aria-hidden="true" />
      {REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`request-status request-status-${EVENT_TONES[status]}`}>
      <span className="request-status-dot" aria-hidden="true" />
      {EVENT_STATUS_LABELS[status]}
    </span>
  );
}

export type VenueAvailabilityState = 'checking' | 'open' | 'competing' | 'booked' | 'unknown';

const AVAILABILITY_LABELS: Record<VenueAvailabilityState, string> = {
  checking: 'Checking availability',
  open: 'Open for requests',
  competing: 'Competing requests',
  booked: 'Booked at this time',
  unknown: 'Availability unverified',
};

export function VenueListItem({
  venue,
  search,
  availability,
}: {
  venue: Venue;
  search: string;
  availability?: VenueAvailabilityState;
}) {
  const href = `/venues/${venue.id}${search ? `?${search}` : ''}`;
  const facilities = venue.facilities.slice(0, 3);
  const canRequest = availability === 'open' || availability === 'competing';
  const action = availability === 'booked' ? 'Find another time' : canRequest ? 'Review this slot' : 'View calendar';

  return (
    <li className="venue-choice">
      <article>
        <header className="venue-choice-head">
          <h3>{venue.name}</h3>
          {availability && <span className={`venue-slot-status is-${availability}`}>{AVAILABILITY_LABELS[availability]}</span>}
        </header>
        <div className="venue-choice-facts">
          <span><MapPin size={17} aria-hidden="true" /> {venue.building} · {venue.floor === 0 ? 'Ground floor' : `Floor ${venue.floor}`}</span>
          <span><UsersThree size={17} aria-hidden="true" /> <strong>{venue.capacity} seats</strong></span>
        </div>
        {facilities.length > 0 && (
          <ul className="venue-choice-facilities" aria-label="Facilities">
            {facilities.map((facility) => <li key={facility}>{facility}</li>)}
            {venue.facilities.length > facilities.length && <li>+{venue.facilities.length - facilities.length} more</li>}
          </ul>
        )}
        <footer className="venue-choice-footer">
          <span>{venue.department?.name ?? 'College common'}</span>
          <Link
            to={href}
            aria-label={`${action} for ${venue.name}`}
            className={`btn ${canRequest ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          >
            {action} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </footer>
      </article>
    </li>
  );
}
