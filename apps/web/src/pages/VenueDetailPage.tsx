import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarBlank,
  CheckCircle,
  Clock,
  Info,
  WarningCircle,
} from '@phosphor-icons/react';
import { api, ApiError } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { useToast, Alert, Button, PageHeader, SelectField, Skeleton, TextField, TextareaField } from '../components/ui';
import { VenueCalendar, type CalendarMode } from '../components/VenueCalendar';
import {
  addDays,
  combineDateTime,
  dateInputValue,
  endOfDay,
  monthGridRange,
  parseDateKey,
  startOfDay,
  startOfWeek,
  timeInputValue,
} from '../lib/datetime';
import { fieldError } from '../lib/api';

const DEFAULT_START = '10:00';
const DEFAULT_END = '12:00';

export function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const editRequestId = searchParams.get('editRequest');
  const draftEventIdParam = searchParams.get('eventId');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { user } = useAuth();
  const isStudent = user?.roles.some((r) => r.role === 'STUDENT');

  const initialDate = searchParams.get('date');
  const [selectedDate, setSelectedDate] = useState(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      const parsed = parseDateKey(initialDate);
      if (dateInputValue(parsed) === initialDate) return parsed;
    }
    return addDays(new Date(), 1);
  });
  const [mode, setMode] = useState<CalendarMode>('month');
  const [anchor, setAnchor] = useState(selectedDate);
  const [date, setDate] = useState(() => dateInputValue(selectedDate));
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endTime, setEndTime] = useState(DEFAULT_END);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attendance, setAttendance] = useState('30');
  const [draftEventId, setDraftEventId] = useState<string | null>(null);
  const [facultyCoordinatorId, setFacultyCoordinatorId] = useState('');

  const facultyQuery = useQuery({
    queryKey: ['department-faculty', user?.department?.id],
    queryFn: () => (user?.department?.id ? api.departmentFaculty(user.department.id) : { faculty: [] }),
    enabled: Boolean(user?.department?.id) && Boolean(isStudent),
    staleTime: 60_000,
  });
  const facultyMembers = facultyQuery.data?.faculty ?? [];

  const venueQuery = useQuery({
    queryKey: ['venue', id],
    queryFn: () => api.venue(id!),
    enabled: Boolean(id),
  });

  const editQuery = useQuery({
    queryKey: ['request', editRequestId],
    queryFn: () => api.requestDetail(editRequestId!),
    enabled: Boolean(editRequestId),
  });

  const draftEventQuery = useQuery({
    queryKey: ['event', draftEventIdParam],
    queryFn: () => api.event(draftEventIdParam!),
    enabled: Boolean(draftEventIdParam) && !editRequestId,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- fill the form once the request loads */
  useEffect(() => {
    if (editQuery.data) {
      const { request, event } = editQuery.data;
      const start = new Date(request.startTime);
      setDate(dateInputValue(start));
      setStartTime(timeInputValue(start));
      setEndTime(timeInputValue(new Date(request.endTime)));
      setAnchor(start);
      setSelectedDate(start);
      setTitle(event.title);
      setDescription(event.description ?? '');
      setAttendance(String(event.expectedAttendance));
      if (event.facultyCoordinatorId) {
        setFacultyCoordinatorId(event.facultyCoordinatorId);
      }
      return;
    }
    const event = draftEventQuery.data?.event;
    if (event) {
      setTitle(event.title);
      setDescription(event.description ?? '');
      setAttendance(String(event.expectedAttendance));
      if (event.facultyCoordinatorId) {
        setFacultyCoordinatorId(event.facultyCoordinatorId);
      }
    }
  }, [editQuery.data, draftEventQuery.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const calendarRange = useMemo(() => {
    if (mode === 'month') {
      return monthGridRange(anchor);
    }
    if (mode === 'week') {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 7) };
    }
    return { start: startOfDay(selectedDate), end: endOfDay(selectedDate) };
  }, [anchor, mode, selectedDate]);

  const calendarQuery = useQuery({
    queryKey: ['venue-calendar', id, calendarRange.start.toISOString(), calendarRange.end.toISOString()],
    queryFn: () =>
      api.venueCalendar(id!, calendarRange.start.toISOString(), calendarRange.end.toISOString()),
    enabled: Boolean(id),
    placeholderData: (previous) => previous,
  });

  const requestedStart = useMemo(() => {
    if (!date || !startTime) return null;
    return combineDateTime(date, startTime);
  }, [date, startTime]);
  const requestedEnd = useMemo(() => {
    if (!date || !endTime) return null;
    return combineDateTime(date, endTime);
  }, [date, endTime]);

  const timesValid =
    requestedStart &&
    requestedEnd &&
    !Number.isNaN(requestedStart.getTime()) &&
    !Number.isNaN(requestedEnd.getTime()) &&
    requestedEnd > requestedStart;

  const availabilityQuery = useQuery({
    queryKey: [
      'venue-availability',
      id,
      requestedStart?.toISOString(),
      requestedEnd?.toISOString(),
      editRequestId,
    ],
    queryFn: () =>
      api.venueAvailability(
        id!,
        requestedStart!.toISOString(),
        requestedEnd!.toISOString(),
        editRequestId ?? undefined,
      ),
    enabled: Boolean(id) && Boolean(timesValid),
    retry: false,
  });

  const venue = venueQuery.data?.venue;
  const editing = Boolean(editRequestId);
  const editRequest = editQuery.data?.request;
  const editBlocked =
    editing &&
    editRequest &&
    ['CANCELLED', 'REJECTED', 'SUPERSEDED_CONFLICT', 'CONFIRMED'].includes(editRequest.status);
  const draftEvent = draftEventQuery.data?.event;
  const hasActiveRequest = Boolean(
    draftEvent?.requests?.some((r) =>
      ['SUBMITTED', 'IN_REVIEW', 'APPROVED_PENDING_ALLOTMENT', 'CONFIRMED'].includes(r.status),
    ),
  );
  const draftEventBlocked = Boolean(
    draftEvent &&
      (draftEvent.status === 'CANCELLED' ||
        draftEvent.status === 'COMPLETED' ||
        hasActiveRequest),
  );

  const capacity = Number(attendance);
  const capacityValid = venue ? Number.isInteger(capacity) && capacity >= 1 && capacity <= venue.capacity : false;
  const hasConfirmedConflict = availabilityQuery.data?.hasConfirmedConflict ?? false;
  const pendingConflicts = availabilityQuery.data?.pendingConflicts ?? [];
  const canSubmit =
    Boolean(venue?.isActive) &&
    !editBlocked &&
    !draftEventBlocked &&
    (!editing || editQuery.isSuccess) &&
    (!draftEventIdParam || draftEventQuery.isSuccess) &&
    Boolean(date >= dateInputValue(new Date())) &&
    Boolean(title.trim().length >= 3) &&
    capacityValid &&
    Boolean(timesValid) &&
    !hasConfirmedConflict &&
    availabilityQuery.isSuccess &&
    !availabilityQuery.isFetching &&
    (!isStudent || editing || Boolean(facultyCoordinatorId || draftEvent?.facultyCoordinatorId));

  const submit = useMutation({
    mutationFn: async () => {
      if (!venue || !requestedStart || !requestedEnd) throw new Error('Complete the booking details.');
      const eventInput = {
        title: title.trim(),
        description: description.trim(),
        expectedAttendance: capacity,
      };

      if (editing && editRequestId) {
        return api.updateRequest(editRequestId, {
          venueId: venue.id,
          startTime: requestedStart.toISOString(),
          endTime: requestedEnd.toISOString(),
          event: eventInput,
        });
      }

      const targetDraftEvent = draftEvent || (draftEventId ? { id: draftEventId, facultyCoordinatorId: null } : null);
      if (targetDraftEvent) {
        if (
          isStudent &&
          facultyCoordinatorId &&
          targetDraftEvent.facultyCoordinatorId !== facultyCoordinatorId
        ) {
          await api.setEventCoordinator(targetDraftEvent.id, facultyCoordinatorId);
        }
        return api.createRequest({
          eventId: targetDraftEvent.id,
          venueId: venue.id,
          startTime: requestedStart.toISOString(),
          endTime: requestedEnd.toISOString(),
        });
      }

      const createdEvent = await api.createEvent({
        ...eventInput,
        facultyCoordinatorId: facultyCoordinatorId || undefined,
      });
      try {
        return await api.createRequest({
          eventId: createdEvent.event.id,
          venueId: venue.id,
          startTime: requestedStart.toISOString(),
          endTime: requestedEnd.toISOString(),
        });
      } catch (error) {
        setDraftEventId(createdEvent.event.id);
        throw error;
      }
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['venue-calendar'] }),
        queryClient.invalidateQueries({ queryKey: ['venue-availability'] }),
        queryClient.invalidateQueries({ queryKey: ['my-events'] }),
        queryClient.invalidateQueries({ queryKey: ['request'] }),
      ]);
      pushToast({
        tone: 'success',
        title: editing ? 'Booking request updated' : 'Booking request submitted',
        message: 'Pending approval does not reserve the venue yet.',
      });
      setDraftEventId(null);
      navigate(`/my-events?highlight=${result.request.id}`);
    },
  });

  usePageTitle(venue ? venue.name : 'Venue');

  if (venueQuery.isPending) {
    return (
      <div className="venue-detail-loading">
        <Skeleton className="skeleton-line skeleton-line-wide" />
        <Skeleton className="skeleton-block" />
      </div>
    );
  }

  if (venueQuery.isError || !venue) {
    return (
      <>
        <PageHeader eyebrow="Venue discovery" title="Venue not available" />
        <Alert tone="danger" title="Could not open this venue">
          {venueQuery.error instanceof ApiError
            ? venueQuery.error.message
            : 'Check your connection and try again.'}
        </Alert>
        <Link to="/venues" className="btn btn-secondary btn-md">
          <ArrowLeft size={16} /> Back to venues
        </Link>
      </>
    );
  }

  function selectDate(next: Date) {
    setSelectedDate(next);
    setDate(dateInputValue(next));
    setAnchor(next);
  }

  return (
    <>
      <div className="detail-breadcrumb">
        <Link to={draftEventIdParam ? `/venues?eventId=${draftEventIdParam}` : '/venues'} className="text-link">
          <ArrowLeft size={16} aria-hidden="true" /> All venues
        </Link>
      </div>
      <PageHeader
        title={venue.name}
        description={`${venue.building} · ${venue.floor === 0 ? 'Ground floor' : `Floor ${venue.floor}`} · ${venue.department?.name ?? 'College common'}`}
        actions={venue.isActive && (
          <a href="#booking-heading" className="btn btn-primary btn-md">
            <CalendarBlank size={17} aria-hidden="true" /> {editing ? 'Edit request' : 'Request this venue'}
          </a>
        )}
      />

      <div className="venue-detail-facts">
        <span><strong>{venue.capacity} seats</strong></span>
        <span>{venue.setupBufferMins} min setup · {venue.teardownBufferMins} min cleanup</span>
        {!venue.isActive && <span>Archived</span>}
        {venue.facilities.length > 0 && (
          <details className="venue-facilities-details">
            <summary>Facilities ({venue.facilities.length})</summary>
            <ul>{venue.facilities.map((facility) => <li key={facility}>{facility}</li>)}</ul>
          </details>
        )}
      </div>

      <div className="venue-detail-grid">
        <div className="venue-detail-main">
          <VenueCalendar
            entries={calendarQuery.data?.entries ?? []}
            mode={mode}
            anchor={anchor}
            selectedDate={selectedDate}
            loading={calendarQuery.isPending || calendarQuery.isPlaceholderData}
            unavailable={calendarQuery.isError}
            onModeChange={(nextMode) => {
              setAnchor(selectedDate);
              setMode(nextMode);
            }}
            onAnchorChange={setAnchor}
            onSelectDate={selectDate}
          />
          {calendarQuery.isError && (
            <div className="page-alert">
              <Alert tone="danger" title="Calendar unavailable">
                <button type="button" className="inline-link" onClick={() => void calendarQuery.refetch()}>Try again</button>
              </Alert>
            </div>
          )}
        </div>

        <aside className="booking-panel" aria-labelledby="booking-heading">
          <div className="booking-panel-head">
            <div>
              <h2 id="booking-heading" tabIndex={-1}>{editing ? 'Update your booking' : 'Plan your event'}</h2>
              <p>
                {editing
                  ? 'Changing the date or time resets the approval workflow.'
                  : 'Choose a slot, then add the details for your request.'}
              </p>
            </div>
          </div>

          {editing && editQuery.isPending && (
            <div className="booking-loading">
              <Skeleton className="skeleton-line skeleton-line-wide" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-block" />
            </div>
          )}

          {editBlocked && (
            <Alert tone="warning" title="This request cannot be edited">
              Cancel the confirmed booking from My events before choosing a new slot.
            </Alert>
          )}

          {draftEventId && (
            <Alert tone="warning" title="Event saved as a draft">
              The venue request could not be submitted. Your event draft was kept —{' '}
              <Link to={`/venues?eventId=${draftEventId}`} className="inline-link">
                choose another slot
              </Link>{' '}
              or retry from My events.
            </Alert>
          )}

          {draftEventBlocked && (
            <Alert tone="warning" title="This event can no longer be booked">
              The event is {draftEvent?.status.toLowerCase()}. Create a new event from{' '}
              <Link to="/venues" className="inline-link">
                venue discovery
              </Link>
              .
            </Alert>
          )}

          {draftEventQuery.isError && (
            <Alert tone="warning" title="Draft event unavailable">
              <button type="button" className="inline-link" onClick={() => void draftEventQuery.refetch()}>Try again</button>
              {' or return to '}
              <Link to="/my-events" className="inline-link">My events</Link>.
            </Alert>
          )}

          {!venue.isActive && (
            <Alert tone="warning" title="Venue archived">
              This venue is not accepting new requests.
            </Alert>
          )}

          {editQuery.isError && (
            <Alert tone="danger" title="Could not load this request">
              <button type="button" className="inline-link" onClick={() => void editQuery.refetch()}>Try again</button>
            </Alert>
          )}

          <form onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) submit.mutate();
          }}>
            <fieldset
              className="booking-fieldset"
              disabled={!venue.isActive || Boolean(editBlocked) || Boolean(editing && !editQuery.isSuccess) ||
                Boolean(draftEventIdParam && !draftEventQuery.isSuccess) || submit.isPending}
            >
              <legend className="sr-only">Venue request</legend>
              <h3 className="booking-section-title">Schedule</h3>
              <div className="booking-time-grid">
                <TextField
                  label="Date"
                  name="booking-date"
                  type="date"
                  value={date}
                  min={dateInputValue(new Date())}
                  onChange={(event) => {
                    setDate(event.target.value);
                    if (event.target.value) {
                      const next = parseDateKey(event.target.value);
                      setSelectedDate(next);
                      setAnchor(next);
                    }
                  }}
                  required
                />
                <TextField
                  label="Start"
                  name="booking-start"
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  required
                />
                <TextField
                  label="End"
                  name="booking-end"
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  required
                />
              </div>

              {!timesValid && date && startTime && endTime && (
                <p className="booking-inline-error">
                  <WarningCircle size={15} /> The end time must be after the start time.
                </p>
              )}

              {timesValid && availabilityQuery.isFetching && (
                <div className="availability-note is-checking">
                  <Clock size={17} /> Checking availability…
                </div>
              )}

              {timesValid && hasConfirmedConflict && (
                <div className="availability-note is-blocked">
                  <WarningCircle size={18} />
                  <div>
                    <strong>This slot is already confirmed.</strong>
                    <p>
                      {availabilityQuery.data?.confirmedConflicts[0]?.title ?? 'Another event'} holds
                      the venue. Choose another date or time.
                    </p>
                  </div>
                </div>
              )}

              {timesValid && !hasConfirmedConflict && pendingConflicts.length > 0 && (
                <div className="availability-note is-warning">
                  <Info size={18} />
                  <div>
                    <strong>
                      {pendingConflicts.length} overlapping pending request
                      {pendingConflicts.length === 1 ? '' : 's'}
                    </strong>
                    <p>
                      You can still apply. Pending requests do not reserve the venue; the final
                      approval decides the slot.
                    </p>
                  </div>
                </div>
              )}

              {timesValid && !hasConfirmedConflict && pendingConflicts.length === 0 && availabilityQuery.isSuccess && !availabilityQuery.isFetching && (
                <div className="availability-note is-open">
                  <CheckCircle size={18} />
                  <div>
                    <strong>No conflicts found.</strong>
                    <p>This slot is open for a request.</p>
                  </div>
                </div>
              )}

              {availabilityQuery.isError && (
                <Alert tone="danger" title="Could not check availability">
                  {availabilityQuery.error instanceof ApiError && <p>{availabilityQuery.error.message}</p>}
                  <button type="button" className="inline-link" onClick={() => void availabilityQuery.refetch()}>Try again</button>
                </Alert>
              )}

              <h3 className="booking-section-title">Event details</h3>
              {draftEvent && (
                <p className="booking-draft-note">Update saved event details from <Link className="inline-link" to="/my-events">My events</Link>.</p>
              )}
              <TextField
                label="Event title"
                name="booking-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Robotics club showcase"
                maxLength={200}
                minLength={3}
                readOnly={Boolean(draftEvent || draftEventId)}
                required
                error={submit.error ? fieldError(submit.error, 'event.title') : undefined}
              />
              <TextareaField
                label="Description"
                name="booking-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Purpose, audience and any setup notes"
                rows={3}
                maxLength={2000}
                readOnly={Boolean(draftEvent || draftEventId)}
                optional
              />
              <TextField
                label="Expected attendance"
                name="booking-attendance"
                type="number"
                min={1}
                max={venue.capacity}
                value={attendance}
                onChange={(event) => setAttendance(event.target.value)}
                readOnly={Boolean(draftEvent || draftEventId)}
                hint={`This venue holds up to ${venue.capacity} people.`}
                required
                error={submit.error ? fieldError(submit.error, 'event.expectedAttendance') : undefined}
              />

              {isStudent && !editing && (
                <div className="faculty-endorsement-banner">
                  <SelectField
                    label="Designated faculty coordinator"
                    name="booking-faculty-coordinator"
                    value={facultyCoordinatorId}
                    onChange={(e) => setFacultyCoordinatorId(e.target.value)}
                    required
                    hint="Your coordinator endorses the request before it moves to venue approvals."
                  >
                    <option value="">
                      Select a faculty coordinator from {user?.department?.name ?? 'your department'}…
                    </option>
                    {facultyMembers.map((f) => (
                      <option key={f.userId} value={f.userId}>
                        {f.firstName} {f.lastName} ({f.email})
                      </option>
                    ))}
                  </SelectField>
                </div>
              )}

              {submit.isError && !draftEventId && (
                <Alert tone="danger" title="Could not submit request">
                  {submit.error instanceof ApiError
                    ? submit.error.message
                    : 'Check the details and try again.'}
                </Alert>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="btn-block"
                loading={submit.isPending}
                disabled={!canSubmit}
              >
                {editing ? 'Update request' : 'Submit booking request'}
              </Button>
            </fieldset>
          </form>
        </aside>
      </div>
    </>
  );
}
