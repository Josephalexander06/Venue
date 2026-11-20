import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Buildings,
  Clock,
  MapPin,
  UsersThree,
} from '@phosphor-icons/react';
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

export function VenueCard({ venue, eventId }: { venue: Venue; eventId?: string | null }) {
  const href = `/venues/${venue.id}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`;
  return (
    <article className="venue-card">
      <div className="venue-card-top">
        <div>
          <p className="venue-code">{venue.code}</p>
          <h2>
            <Link to={href}>{venue.name}</Link>
          </h2>
        </div>
        <span className={`venue-availability ${venue.isActive ? 'is-open' : 'is-closed'}`}>
          {venue.isActive ? 'Available' : 'Archived'}
        </span>
      </div>

      <dl className="venue-facts">
        <div>
          <dt>
            <MapPin size={15} aria-hidden="true" /> Location
          </dt>
          <dd>
            {venue.building}
            {venue.floor !== 0 ? ` · Floor ${venue.floor}` : ' · Ground floor'}
          </dd>
        </div>
        <div>
          <dt>
            <UsersThree size={15} aria-hidden="true" /> Capacity
          </dt>
          <dd>{venue.capacity} people</dd>
        </div>
        <div>
          <dt>
            <Buildings size={15} aria-hidden="true" /> Owner
          </dt>
          <dd>{venue.department?.name ?? 'College common'}</dd>
        </div>
        <div>
          <dt>
            <Clock size={15} aria-hidden="true" /> Buffers
          </dt>
          <dd>
            {venue.setupBufferMins} min setup · {venue.teardownBufferMins} min cleanup
          </dd>
        </div>
      </dl>

      <div className="venue-facilities" aria-label="Facilities">
        {venue.facilities.length === 0 ? (
          <span className="facility-chip is-muted">No listed facilities</span>
        ) : (
          venue.facilities.map((facility) => (
            <span className="facility-chip" key={facility}>
              {facility}
            </span>
          ))
        )}
      </div>

      <Link to={href} className="btn btn-secondary btn-sm venue-card-action">
        View calendar and book <ArrowRight size={15} />
      </Link>
    </article>
  );
}
