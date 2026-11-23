import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Plus } from '@phosphor-icons/react';
import type { EventSummary, EventView } from '../lib/api';
import { api } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';
import { EventCard, EVENT_FILTERS, matchesEventFilter, type EventFilter } from '../components/EventCard';
import { EventWorkspaceDialogs, type EditTarget, type CancelTarget } from '../components/EventWorkspaceDialogs';
import { EventTeamDialog } from '../components/EventTeamDialog';

export function MyEventsPage() {
  usePageTitle('Event workspace');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const highlight = params.get('highlight');
  const { hash } = useLocation();
  const [filter, setFilter] = useState<EventFilter>('all');
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
    event.requests.some((request) => matchesEventFilter(request, filter)),
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
        title="Event workspace"
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
          {EVENT_FILTERS.map((option) => (
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

      <EventWorkspaceDialogs editTarget={editTarget} setEditTarget={setEditTarget} closeEditor={closeEditor}
        saving={saveEvent.isPending} saveError={saveEvent.error} onSave={saveEvent.mutate}
        cancelTarget={cancelTarget} closeCancel={() => setCancelTarget(null)}
        cancelling={cancel.isPending} cancelError={cancel.error} onCancel={cancel.mutate} />

      {teamTarget && (
        <EventTeamDialog
          event={teamTarget}
          onClose={() => setTeamTarget(null)}
        />
      )}
    </>
  );
}
