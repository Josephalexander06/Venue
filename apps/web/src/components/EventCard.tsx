import { Link } from 'react-router-dom';
import { CalendarBlank, ChalkboardTeacher, CheckCircle, Clock, MapPin, NotePencil, Prohibit, UsersThree } from '@phosphor-icons/react';
import type { EventView, RequestView } from '../lib/api';
import { formatDate } from '../lib/format';
import { formatTimeRange } from '../lib/datetime';
import { EventStatusBadge, RequestStatusBadge } from './booking';
import { Button } from './ui';

export type EventFilter = 'all' | 'open' | 'confirmed' | 'closed';

export const EVENT_FILTERS: { value: EventFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'closed', label: 'Closed' },
];

const OPEN_STATUSES = new Set<RequestView['status']>([
  'SUBMITTED',
  'IN_REVIEW',
  'APPROVED_PENDING_ALLOTMENT',
]);

const CLOSED_STATUSES = new Set<RequestView['status']>([
  'REJECTED',
  'CANCELLED',
  'SUPERSEDED_CONFLICT',
]);

export function matchesEventFilter(request: RequestView, filter: EventFilter) {
  if (filter === 'all') return true;
  if (filter === 'confirmed') return request.status === 'CONFIRMED';
  if (filter === 'open') return OPEN_STATUSES.has(request.status);
  return CLOSED_STATUSES.has(request.status);
}

function requestGuidance(request: RequestView) {
  if (request.status === 'CONFIRMED') {
    return 'Confirmed. The venue is reserved for this event.';
  }
  if (request.status === 'APPROVED_PENDING_ALLOTMENT') {
    return 'Preliminary approval received. Final allotment is still pending.';
  }
  if (OPEN_STATUSES.has(request.status)) {
    return 'Awaiting approval. Pending requests do not reserve the venue.';
  }
  if (request.status === 'REJECTED' && request.rejectionReason) {
    return `Rejected: ${request.rejectionReason}`;
  }
  if (request.status === 'SUPERSEDED_CONFLICT') {
    return request.rejectionReason
      ? `Superseded: ${request.rejectionReason}`
      : 'Slot was allotted to another competing event. Please reschedule for a different time or venue.';
  }
  return null;
}

export function EventCard({
  event,
  highlight,
  filter,
  canManage,
  userId,
  isAdmin,
  onEdit,
  onManageTeam,
  onCancelEvent,
  onCancelRequest,
}: {
  event: EventView;
  highlight: string | null;
  filter: EventFilter;
  canManage: boolean;
  userId?: string;
  isAdmin: boolean;
  onEdit: () => void;
  onManageTeam: () => void;
  onCancelEvent: () => void;
  onCancelRequest: (request: RequestView) => void;
}) {
  const isOpen = event.status !== 'CANCELLED' && event.status !== 'COMPLETED';
  const canManageRequest = (request: RequestView) => isAdmin || event.creatorId === userId ||
    request.submittedById === userId || event.facultyCoordinatorId !== userId;
  const activeRequests = event.requests.filter((r) => OPEN_STATUSES.has(r.status) || r.status === 'CONFIRMED');
  const requestCancellationClosesEvent = activeRequests.length === 1 && canManageRequest(activeRequests[0]!);

  return (
    <article className="event-card" id={`event-${event.id}`}>
      <div className="event-card-head">
        <div>
          <div className="event-title-row">
            <h2>{event.title}</h2>
            {(event.requests.length === 0 || !isOpen) && <EventStatusBadge status={event.status} />}
          </div>
          {event.description && <p className="event-description">{event.description}</p>}
          <div className="event-meta">
            <span>
              <UsersThree size={15} /> {event.expectedAttendance} expected
            </span>
            <span>
              <CalendarBlank size={15} /> Created {formatDate(event.createdAt)}
            </span>
            <span>{event.department.code}</span>
            {event.facultyCoordinator && (
              <span>
                <ChalkboardTeacher size={15} aria-hidden="true" /> {event.facultyCoordinator.firstName}{' '}
                {event.facultyCoordinator.lastName}
              </span>
            )}
            {event.creatorId !== userId && (
              <span>{event.facultyCoordinatorId === userId ? 'You coordinate' : 'Assigned event'}</span>
            )}
          </div>
        </div>
        <div className="event-actions">
          <Button variant="secondary" size="sm" onClick={onManageTeam}>
            <UsersThree size={15} /> Event team
          </Button>
          {isOpen && canManage && (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <NotePencil size={15} /> Edit details
            </Button>
          )}
          {isOpen && event.requests.length > 0 &&
            !event.requests.some((r) => OPEN_STATUSES.has(r.status) || r.status === 'CONFIRMED') &&
            !event.requests.some((r) => r.status === 'REJECTED' || r.status === 'SUPERSEDED_CONFLICT') && (
              <Link to={`/venues?eventId=${event.id}`} className="btn btn-secondary btn-sm">
                <CalendarBlank size={15} /> Reschedule venue
              </Link>
            )}
          {isOpen && canManage && !requestCancellationClosesEvent && (
            <Button variant="danger-ghost" size="sm" onClick={onCancelEvent}>
              <Prohibit size={15} /> Cancel event
            </Button>
          )}
        </div>
      </div>

      {event.requests.length === 0 ? (
        <div className="event-no-requests">
          <Clock size={22} weight="duotone" aria-hidden="true" />
          <div>
            <strong>No venue requested yet</strong>
            <p>
              {isOpen ? 'Choose a venue and a date to submit this event for approval.' : 'This event is closed.'}
            </p>
          </div>
          {isOpen && (
            <Link to={`/venues?eventId=${event.id}`} className="btn btn-primary btn-sm">
              Choose a venue
            </Link>
          )}
        </div>
      ) : (
        <ul className="booking-history">
          {event.requests.filter((request) => matchesEventFilter(request, filter)).map((request) => (
            <li
              key={request.id}
              className={`booking-row ${highlight === request.id ? 'is-highlighted' : ''}`}
            >
              <span className="booking-row-venue">
                <strong>{request.venue.name}</strong>
                <span>
                  <MapPin size={14} /> {request.venue.building} · Floor {request.venue.floor}
                </span>
              </span>
              <span className="booking-row-time">
                <strong>{formatDate(request.startTime)}</strong>
                <span>
                  <Clock size={14} /> {formatTimeRange(request.startTime, request.endTime)}
                </span>
              </span>
              <span className="booking-row-status">
                <RequestStatusBadge status={request.status} />
                {request.requiresFacultyEndorsement && OPEN_STATUSES.has(request.status) && (
                  <span
                    className={`endorsement-pill ${
                      request.facultyEndorsedAt ? 'is-endorsed' : 'is-pending'
                    }`}
                  >
                    {request.facultyEndorsedAt ? (
                      <>
                        <CheckCircle size={13} weight="fill" /> Faculty endorsed
                      </>
                    ) : (
                      <>
                        <Clock size={13} /> Stage 0: Pending endorsement
                      </>
                    )}
                  </span>
                )}
                {requestGuidance(request) && <span>{requestGuidance(request)}</span>}
              </span>
              <span className="booking-row-actions">
                <Link to={`/bookings/${request.id}`} className="btn btn-ghost btn-sm">
                  {request.status === 'CONFIRMED' ? 'View confirmation' : 'Track request'}
                </Link>
                {canManageRequest(request) && OPEN_STATUSES.has(request.status) && (
                  <Link
                    to={`/venues/${request.venue.id}?editRequest=${request.id}`}
                    className="btn btn-secondary btn-sm"
                  >
                    Change slot
                  </Link>
                )}
                {(request.status === 'SUPERSEDED_CONFLICT' || request.status === 'REJECTED') &&
                  !event.requests.some(
                    (r) => OPEN_STATUSES.has(r.status) || r.status === 'CONFIRMED',
                  ) && (
                    <Link
                      to={`/venues?eventId=${event.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Reschedule
                    </Link>
                  )}
                {canManageRequest(request) && (OPEN_STATUSES.has(request.status) || request.status === 'CONFIRMED') && (
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    onClick={() => onCancelRequest(request)}
                  >
                    {request.status === 'CONFIRMED' ? 'Cancel booking' : 'Cancel request'}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
