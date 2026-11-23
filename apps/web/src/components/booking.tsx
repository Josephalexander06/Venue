import {
  EVENT_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  type EventStatus,
  type RequestStatus,
} from '@venue/shared';

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
