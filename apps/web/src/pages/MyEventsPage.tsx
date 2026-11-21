import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarBlank,
  CalendarCheck,
  ChalkboardTeacher,
  CheckCircle,
  Clock,
  MapPin,
  NotePencil,
  Plus,
  Prohibit,
  UsersThree,
} from '@phosphor-icons/react';
import type { EventSummary, EventView, RequestView } from '../lib/api';
import { api, ApiError, fieldError } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
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
import { EventTeamDialog } from '../components/EventTeamDialog';

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
  if (request.status === 'SUPERSEDED_CONFLICT') {
    return request.rejectionReason
      ? `Superseded: ${request.rejectionReason}`
      : 'Slot was allotted to another competing event. Please reschedule for a different time or venue.';
  }
  return null;
}

interface EditTarget {
  event?: EventView;
  title: string;
  description: string;
  attendance: string;
}

interface CancelTarget {
  type: 'event' | 'request' | 'booking';
  id: string;
  label: string;
}

export function MyEventsPage() {
  usePageTitle('My events');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const highlight = params.get('highlight');
  const { hash } = useLocation();
  const [filter, setFilter] = useState<Filter>('all');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(() =>
    params.get('create') === '1' ? { title: '', description: '', attendance: '' } : null,
  );
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [teamTarget, setTeamTarget] = useState<EventSummary | null>(null);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const eventsQuery = useQuery({
    queryKey: ['my-events'],
    queryFn: api.myEvents,
  });

  const events = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data]);

  const visibleEvents = events.filter((event) =>
    filter === 'all' || (filter === 'open' && event.status === 'DRAFT') ||
    event.requests.some((request) => matchesFilter(request, filter)),
  );

  useEffect(() => {
    if (events.length && hash.startsWith('#event-')) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'nearest' });
    }
  }, [events, hash]);

  function invalidate() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-events'] }),
      queryClient.invalidateQueries({ queryKey: ['venue-calendar'] }),
      queryClient.invalidateQueries({ queryKey: ['venue-availability'] }),
      queryClient.invalidateQueries({ queryKey: ['request'] }),
    ]);
  }

  function closeEditor() {
    setEditTarget(null);
    if (params.has('create')) {
      const next = new URLSearchParams(params);
      next.delete('create');
      setParams(next, { replace: true });
    }
  }

  const saveEvent = useMutation({
    mutationFn: (target: EditTarget) => {
      const input = {
        title: target.title.trim(),
        description: target.description.trim(),
        expectedAttendance: Number(target.attendance),
      };
      return target.event ? api.updateEvent(target.event.id, input) : api.createEvent(input);
    },
    onSuccess: async (result, target) => {
      queryClient.setQueryData(['event', result.event.id], result);
      if (!target.event) {
        void navigate(`/venues?eventId=${result.event.id}`, { replace: true });
      }
      await invalidate();
      if (target.event) closeEditor();
      pushToast({ tone: 'success', title: target.event ? 'Event details updated' : 'Event created' });
    },
  });

  const cancel = useMutation({
    mutationFn: async (target: CancelTarget): Promise<unknown> =>
      target.type === 'event' ? api.cancelEvent(target.id) : api.cancelRequest(target.id),
    onSuccess: async (_result, target) => {
      await invalidate();
      setCancelTarget(null);
      pushToast({ tone: 'success', title: `Cancelled ${target.type}` });
    },
  });

  function openEdit(event: EventView) {
    saveEvent.reset();
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
        title="My events"
        description="Manage your events, event teams and venue requests."
        actions={
          <>
            <Link to="/venues" className="btn btn-secondary btn-md">Browse venues</Link>
            <Button onClick={() => {
              saveEvent.reset();
              setEditTarget({ title: '', description: '', attendance: '' });
            }}>
              <Plus size={17} aria-hidden="true" /> Create event
            </Button>
          </>
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
        <div className="filter-tabs" role="group" aria-label="Booking status">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              className={`filter-tab ${filter === option.value ? 'is-active' : ''}`}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
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
      ) : eventsQuery.isError ? null : visibleEvents.length === 0 ? (
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
              filter={filter}
              canManage={isAdmin || event.creatorId === user?.id || event.facultyCoordinatorId === user?.id}
              userId={user?.id}
              isAdmin={isAdmin}
              onEdit={() => openEdit(event)}
              onManageTeam={() => setTeamTarget(event)}
              onCancelEvent={() =>
                setCancelTarget({ type: 'event', id: event.id, label: event.title })
              }
              onCancelRequest={(request) =>
                setCancelTarget({
                  type: request.status === 'CONFIRMED' ? 'booking' : 'request',
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
        onClose={closeEditor}
        title={editTarget?.event ? 'Edit event details' : 'Create an event'}
        description={editTarget?.event
          ? 'To change a date or venue, update the booking separately.'
          : 'Save an event now and request a venue when you are ready.'}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={closeEditor}>
              Cancel
            </Button>
            <Button
              size="md"
              type="submit"
              form="event-editor"
              loading={saveEvent.isPending}
              disabled={saveEvent.isPending}
            >
              {editTarget?.event ? 'Save changes' : 'Create event'}
            </Button>
          </>
        }
      >
        {editTarget && (
          <form id="event-editor" className="dialog-form" onSubmit={(event) => {
            event.preventDefault();
            saveEvent.mutate(editTarget);
          }}>
            <TextField
              label="Event title"
              name="event-title"
              value={editTarget.title}
              onChange={(change) =>
                setEditTarget({ ...editTarget, title: change.target.value })
              }
              minLength={3}
              maxLength={200}
              error={fieldError(saveEvent.error, 'title')}
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
              max={100000}
              value={editTarget.attendance}
              error={fieldError(saveEvent.error, 'expectedAttendance')}
              onChange={(change) =>
                setEditTarget({ ...editTarget, attendance: change.target.value })
              }
              required
            />
            {saveEvent.isError && (
              <Alert tone="danger" title="Could not save event">
                {saveEvent.error instanceof ApiError ? saveEvent.error.message : 'Check the details and try again.'}
              </Alert>
            )}
          </form>
        )}
      </Dialog>

      <Dialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={`Cancel this ${cancelTarget?.type ?? 'event'}?`}
        description={
          cancelTarget?.type === 'event'
            ? 'This also cancels every open booking request for the event.'
            : cancelTarget?.type === 'booking'
              ? 'The reserved slot is released. If this is the last booking, the event is also cancelled.'
              : 'If this is the last request, the event is also cancelled.'
        }
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setCancelTarget(null)}>
              Keep {cancelTarget?.type}
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={cancel.isPending}
              onClick={() => cancelTarget && cancel.mutate(cancelTarget)}
            >
              Cancel {cancelTarget?.type}
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

      {teamTarget && (
        <EventTeamDialog
          event={teamTarget}
          onClose={() => setTeamTarget(null)}
        />
      )}
    </>
  );
}

function EventCard({
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
  filter: Filter;
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
          {event.requests.filter((request) => matchesFilter(request, filter)).map((request) => (
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
                <Link to={`/my-events/requests/${request.id}`} className="btn btn-ghost btn-sm">
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
