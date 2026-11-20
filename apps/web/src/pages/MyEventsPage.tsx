import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarBlank,
  CalendarCheck,
  Clock,
  MapPin,
  NotePencil,
  Plus,
  Prohibit,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import type { EventView, RequestView } from '../lib/api';
import { api, ApiError, fieldError } from '../lib/api';
import { usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import { formatTimeRange } from '../lib/datetime';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
  TextField,
  TextareaField,
  useToast,
} from '../components/ui';
import { EventStatusBadge, RequestStatusBadge } from '../components/booking';

type Filter = 'all' | 'open' | 'confirmed' | 'closed';

const FILTERS: { value: Filter; label: string }[] = [
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

function matchesFilter(request: RequestView, filter: Filter) {
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
  return null;
}

interface EditTarget {
  event: EventView;
  title: string;
  description: string;
  attendance: string;
}

interface CancelTarget {
  type: 'event' | 'request';
  id: string;
  label: string;
}

export function MyEventsPage() {
  usePageTitle('My events');
  const [params] = useSearchParams();
  const highlight = params.get('highlight');
  const [filter, setFilter] = useState<Filter>('all');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const eventsQuery = useQuery({
    queryKey: ['my-events'],
    queryFn: api.myEvents,
  });

  const events = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data]);

  const visibleEvents = useMemo(
    () =>
      events
        .map((event) => ({
          ...event,
          requests: event.requests.filter((request) => matchesFilter(request, filter)),
        }))
        .filter((event) => {
          if (filter === 'all') return true;
          if (filter === 'open' && event.requests.length === 0) return event.status === 'DRAFT';
          return event.requests.length > 0;
        }),
    [events, filter],
  );

  function invalidate() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-events'] }),
      queryClient.invalidateQueries({ queryKey: ['venue-calendar'] }),
      queryClient.invalidateQueries({ queryKey: ['venue-availability'] }),
      queryClient.invalidateQueries({ queryKey: ['request'] }),
    ]);
  }

  const updateEvent = useMutation({
    mutationFn: (target: EditTarget) =>
      api.updateEvent(target.event.id, {
        title: target.title.trim(),
        description: target.description.trim(),
        expectedAttendance: Number(target.attendance),
      }),
    onSuccess: async () => {
      await invalidate();
      setEditTarget(null);
      pushToast({ tone: 'success', title: 'Event details updated' });
    },
  });

  const cancel = useMutation({
    mutationFn: async (target: CancelTarget): Promise<unknown> =>
      target.type === 'event' ? api.cancelEvent(target.id) : api.cancelRequest(target.id),
    onSuccess: async () => {
      await invalidate();
      setCancelTarget(null);
      pushToast({ tone: 'success', title: 'Booking cancelled' });
    },
  });

  function openEdit(event: EventView) {
    updateEvent.reset();
    setEditTarget({
      event,
      title: event.title,
      description: event.description ?? '',
      attendance: String(event.expectedAttendance),
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Your bookings"
        title="My events"
        description="Track every request, update an event and keep an eye on what is confirmed."
        actions={
          <Link to="/venues" className="btn btn-primary btn-md">
            <Plus size={17} /> Book a venue
          </Link>
        }
      />

      {eventsQuery.isError && (
        <div className="page-alert">
          <Alert tone="danger" title="Could not load your events">
            Check your connection and{' '}
            <button type="button" className="inline-link" onClick={() => void eventsQuery.refetch()}>
              try again
            </button>
            .
          </Alert>
        </div>
      )}

      <div className="booking-filter-bar">
        <div className="filter-tabs" role="tablist" aria-label="Booking status">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              className={`filter-tab ${filter === option.value ? 'is-active' : ''}`}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="booking-filter-note">
          <WarningCircle size={15} /> Pending approval never confirms a venue.
        </span>
      </div>

      {eventsQuery.isPending ? (
        <div className="event-list" aria-hidden="true">
          {[0, 1].map((item) => (
            <div className="event-card" key={item}>
              <Skeleton className="skeleton-line skeleton-line-wide" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-block" />
            </div>
          ))}
        </div>
      ) : visibleEvents.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CalendarCheck size={28} weight="duotone" />}
            title={events.length === 0 ? 'No events yet' : 'Nothing in this view'}
            description={
              events.length === 0
                ? 'Find a venue, pick a slot on its calendar and submit your first booking request.'
                : 'Try another status filter or create a new booking.'
            }
            action={
              <Link to="/venues" className="btn btn-primary btn-sm">
                Browse venues
              </Link>
            }
          />
        </div>
      ) : (
        <div className="event-list">
          {visibleEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              highlight={highlight}
              onEdit={() => openEdit(event)}
              onCancelEvent={() =>
                setCancelTarget({ type: 'event', id: event.id, label: event.title })
              }
              onCancelRequest={(request) =>
                setCancelTarget({
                  type: 'request',
                  id: request.id,
                  label: `${event.title} at ${request.venue.name}`,
                })
              }
            />
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title="Edit event details"
        description="Title, description and attendance update immediately. Date or venue changes use the booking flow."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button
              size="md"
              loading={updateEvent.isPending}
              disabled={!editTarget || editTarget.title.trim().length < 3}
              onClick={() => editTarget && updateEvent.mutate(editTarget)}
            >
              Save event
            </Button>
          </>
        }
      >
        {editTarget && (
          <div className="dialog-form">
            <TextField
              label="Event title"
              name="event-title"
              value={editTarget.title}
              onChange={(change) =>
                setEditTarget({ ...editTarget, title: change.target.value })
              }
              maxLength={200}
              required
            />
            <TextareaField
              label="Description"
              name="event-description"
              value={editTarget.description}
              onChange={(change) =>
                setEditTarget({ ...editTarget, description: change.target.value })
              }
              rows={4}
              maxLength={2000}
              optional
            />
            <TextField
              label="Expected attendance"
              name="event-attendance"
              type="number"
              min={1}
              value={editTarget.attendance}
              onChange={(change) =>
                setEditTarget({ ...editTarget, attendance: change.target.value })
              }
              required
            />
            {updateEvent.isError && (
              <Alert tone="danger" title="Could not update event">
                {updateEvent.error instanceof ApiError
                  ? (fieldError(updateEvent.error, 'expectedAttendance') ??
                    updateEvent.error.message)
                  : 'Check the details and try again.'}
              </Alert>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={cancelTarget?.type === 'event' ? 'Cancel this event?' : 'Cancel this request?'}
        description={
          cancelTarget?.type === 'event'
            ? 'This also cancels every open booking request for the event.'
            : 'The slot is released immediately if it was confirmed.'
        }
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setCancelTarget(null)}>
              Keep booking
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={cancel.isPending}
              onClick={() => cancelTarget && cancel.mutate(cancelTarget)}
            >
              Cancel booking
            </Button>
          </>
        }
      >
        <p className="dialog-confirm-copy">
          {cancelTarget?.label} will be marked as cancelled. This cannot be undone.
        </p>
        {cancel.isError && (
          <Alert tone="danger" title="Could not cancel">
            {cancel.error instanceof ApiError ? cancel.error.message : 'Try again.'}
          </Alert>
        )}
      </Dialog>
    </>
  );
}

function EventCard({
  event,
  highlight,
  onEdit,
  onCancelEvent,
  onCancelRequest,
}: {
  event: EventView;
  highlight: string | null;
  onEdit: () => void;
  onCancelEvent: () => void;
  onCancelRequest: (request: RequestView) => void;
}) {
  const canCancelEvent = event.status !== 'CANCELLED' && event.status !== 'COMPLETED';

  return (
    <article className="event-card">
      <div className="event-card-head">
        <div>
          <div className="event-title-row">
            <h2>{event.title}</h2>
            <EventStatusBadge status={event.status} />
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
          </div>
        </div>
        <div className="event-actions">
          {event.status !== 'CANCELLED' && event.status !== 'COMPLETED' && (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              <NotePencil size={15} /> Edit details
            </Button>
          )}
          {canCancelEvent && (
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
            <p>Choose a venue and a date to submit this event for approval.</p>
          </div>
          <Link to={`/venues?eventId=${event.id}`} className="btn btn-secondary btn-sm">
            Choose a venue
          </Link>
        </div>
      ) : (
        <ul className="booking-history">
          {event.requests.map((request) => (
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
                {requestGuidance(request) && <span>{requestGuidance(request)}</span>}
              </span>
              <span className="booking-row-actions">
                <Link to={`/venues/${request.venue.id}`} className="btn btn-ghost btn-sm">
                  View calendar
                </Link>
                {OPEN_STATUSES.has(request.status) && (
                  <>
                    <Link
                      to={`/venues/${request.venue.id}?editRequest=${request.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Change slot
                    </Link>
                    <Button
                      variant="danger-ghost"
                      size="sm"
                      onClick={() => onCancelRequest(request)}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
