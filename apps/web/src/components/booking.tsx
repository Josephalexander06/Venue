import { Link } from 'react-router-dom';
import { ArrowRight } from '@phosphor-icons/react';
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

export function VenueListItem({ venue, eventId }: { venue: Venue; eventId?: string | null }) {
  const href = `/venues/${venue.id}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`;
  const facilities = venue.facilities.slice(0, 3);
  return (
    <li>
      <Link className="venue-result" to={href}>
        <span className="venue-result-name">
          <strong>{venue.name}</strong>
          <span>{venue.code} · {venue.department?.name ?? 'College common'}</span>
        </span>
        <span className="venue-result-location">
          <strong>{venue.building}</strong>
          <span>{venue.floor === 0 ? 'Ground floor' : `Floor ${venue.floor}`}</span>
        </span>
        <span className="venue-result-capacity">{venue.capacity} seats</span>
        <span className="venue-result-facilities">
          {facilities.length > 0 ? facilities.join(' · ') : '—'}
          {venue.facilities.length > facilities.length && ` · +${venue.facilities.length - facilities.length}`}
        </span>
        <span className="venue-result-action">View availability <ArrowRight size={16} aria-hidden="true" /></span>
      </Link>
    </li>
  );
}
