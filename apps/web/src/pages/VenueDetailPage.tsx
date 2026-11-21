import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS, WORKFLOW_SCOPE_LABELS } from '@venue/shared';
import {
  ArrowLeft,
  CalendarBlank,
  CheckCircle,
  Clock,
  Info,
  WarningCircle,
} from '@phosphor-icons/react';
import { api, ApiError, fieldError } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { formatDate } from '../lib/format';
import { useToast, Alert, Button, PageHeader, Skeleton, TextField, TextareaField } from '../components/ui';
import { BookingDateField } from '../components/BookingDateField';
import { FacultyCoordinatorField } from '../components/FacultyCoordinatorField';
import { VenueCalendar, type CalendarMode } from '../components/VenueCalendar';
import {
  addDays,
  dateInputValue,
  endOfDay,
  monthGridRange,
  formatTimeRange,
  startOfDay,
  startOfWeek,
  timeInputValue,
} from '../lib/datetime';
import { getVenueSlot, parseBookingDate, readGuestCount, readVenueSlot, venueAvailabilityOptions, type VenueSlot } from '../lib/venue-slot';

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
  const { user, isApprover } = useAuth();
  const needsEndorsement = Boolean(user && !isApprover);

  const initialSlot = readVenueSlot(searchParams);
  const [selectedDate, setSelectedDate] = useState(() =>
    parseBookingDate(searchParams.get('date')) ?? addDays(new Date(), 1),
  );
  const [mode, setMode] = useState<CalendarMode>(initialSlot ? 'day' : 'month');
  const [anchor, setAnchor] = useState(selectedDate);
  const [date, setDate] = useState(() => dateInputValue(selectedDate));
  const [startTime, setStartTime] = useState(initialSlot?.start ?? DEFAULT_START);
  const [endTime, setEndTime] = useState(initialSlot?.end ?? DEFAULT_END);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attendance, setAttendance] = useState(() => String(readGuestCount(searchParams) ?? 30));
  const [draftEventId, setDraftEventId] = useState<string | null>(null);
  const [facultyCoordinatorId, setFacultyCoordinatorId] = useState('');

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

  const slot = getVenueSlot(date, startTime, endTime);
  const requestedStart = slot?.from;
  const requestedEnd = slot?.to;
  const startsInPast = Boolean(requestedStart && requestedStart < new Date());
  const availabilityQuery = useQuery({
    ...venueAvailabilityOptions(id, startsInPast ? null : slot, editRequestId),
    refetchOnMount: 'always',
  });

  const venue = venueQuery.data?.venue;
  const editing = Boolean(editRequestId);
  const editRequest = editQuery.data?.request;
  const editBlocked =
    editing &&
    editRequest &&
    ['CANCELLED', 'REJECTED', 'SUPERSEDED_CONFLICT', 'CONFIRMED'].includes(editRequest.status);
  const draftEvent = draftEventQuery.data?.event;
  const organizerEventId = draftEvent?.creatorId === user?.id ? undefined : draftEvent?.id;
  const teamQuery = useQuery({
    queryKey: ['event-team', organizerEventId],
    queryFn: () => api.eventTeam(organizerEventId!),
    enabled: Boolean(organizerEventId),
  });
  const approvalPreview = useQuery({
    queryKey: ['venue-approval-preview', id],
    queryFn: () => api.venueApprovalPreview(id!),
    enabled: Boolean(id && venue?.isActive && !editing),
  });
  const organizer = organizerEventId ? teamQuery.data?.team.creator : user;
  const eventTitle = (draftEvent?.title ?? title).trim();
  const savedEvent = Boolean(!editing && (draftEventIdParam || draftEventId));
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

  const capacity = draftEvent?.expectedAttendance ?? Number(attendance);
  const capacityValid = venue ? Number.isInteger(capacity) && capacity >= 1 && capacity <= venue.capacity : false;
  const hasConfirmedConflict = availabilityQuery.data?.hasConfirmedConflict ?? false;
  const pendingConflicts = availabilityQuery.data?.pendingConflicts ?? [];
  const alternatives = availabilityQuery.data?.confirmedConflicts ?? [];
  const nextTime = alternatives.length && venue && slot
    ? nextSlotAfterConflicts(venue.setupBufferMins, alternatives.map(({ rangeEnd }) => rangeEnd), slot)
    : null;
  const canSubmit =
    Boolean(venue?.isActive) &&
    !editBlocked &&
    !draftEventBlocked &&
    (!editing || editQuery.isSuccess) &&
    (!draftEventIdParam || draftEventQuery.isSuccess) &&
    !startsInPast &&
    eventTitle.length >= 3 &&
    capacityValid &&
    Boolean(slot) &&
    !hasConfirmedConflict &&
    availabilityQuery.isSuccess &&
    !availabilityQuery.isFetching &&
    (editing || (Boolean(approvalPreview.data && organizer) &&
      (!needsEndorsement || Boolean(facultyCoordinatorId || draftEvent?.facultyCoordinatorId))));

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
          needsEndorsement &&
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
      queryClient.setQueryData(['request', result.request.id], result);
      if (editing) pushToast({ tone: 'success', title: 'Booking request updated' });
      setDraftEventId(null);
      navigate(`/my-events/requests/${result.request.id}`, {
        state: { submitted: !editing },
        replace: true,
      });
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

  const listParams = new URLSearchParams(searchParams);
  listParams.delete('editRequest');
  const backToVenues = listParams.size ? `/venues?${listParams}` : '/venues';

  return (
    <>
      <div className="detail-breadcrumb">
        <Link to={backToVenues} className="text-link">
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
                <BookingDateField
                  label="Date"
                  name="booking-date"
                  value={date}
                  onChange={(value) => {
                    const next = parseBookingDate(value);
                    if (next) selectDate(next);
                    else setDate(value);
                  }}
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

              {!slot && date && startTime && endTime && (
                <p className="booking-inline-error">
                  <WarningCircle size={15} /> The end time must be after the start time.
                </p>
              )}

              {startsInPast && (
                <p className="booking-inline-error">
                  <WarningCircle size={15} aria-hidden="true" /> Choose a start time in the future.
                </p>
              )}

              {slot && availabilityQuery.isFetching && (
                <div className="availability-note is-checking">
                  <Clock size={17} /> Checking availability…
                </div>
              )}

              {slot && hasConfirmedConflict && (
                <div className="availability-note is-blocked">
                  <WarningCircle size={18} />
                  <div>
                    <strong>This slot is already confirmed.</strong>
                    <p>
                      {availabilityQuery.data?.confirmedConflicts[0]?.title ?? 'Another event'} holds
                      the venue, including its setup or cleanup time.
                    </p>
                    {nextTime && (
                      <button type="button" className="inline-link slot-alternative" onClick={() => {
                        setStartTime(timeInputValue(nextTime.from));
                        setEndTime(timeInputValue(nextTime.to));
                      }}>
                        Check {formatTimeRange(nextTime.from, nextTime.to)}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {slot && !hasConfirmedConflict && pendingConflicts.length > 0 && (
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

              {slot && !hasConfirmedConflict && pendingConflicts.length === 0 && availabilityQuery.isSuccess && !availabilityQuery.isFetching && (
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
              {savedEvent ? (
                <div className="booking-draft-note">
                  {(draftEvent || draftEventId) && (
                    <>
                      <strong>{draftEvent?.title ?? title}</strong>
                      <p>{capacity} expected · Venue capacity {venue.capacity}</p>
                      {(draftEvent?.description ?? description) && <p>{draftEvent?.description ?? description}</p>}
                    </>
                  )}
                  {draftEvent?.facultyCoordinator && (
                    <p>Coordinator: {draftEvent.facultyCoordinator.firstName} {draftEvent.facultyCoordinator.lastName}</p>
                  )}
                  <Link className="inline-link" to="/my-events">Manage event details</Link>
                  {(draftEvent || draftEventId) && capacity > venue.capacity && (
                    <Alert tone="danger">This venue is too small for your event.</Alert>
                  )}
                </div>
              ) : (
                <>
                  <TextField
                    label="Event title"
                    name="booking-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="e.g. Robotics club showcase"
                    maxLength={200}
                    minLength={3}
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
                    hint={`This venue holds up to ${venue.capacity} people.`}
                    required
                    error={submit.error ? fieldError(submit.error, 'event.expectedAttendance') : undefined}
                  />
                </>
              )}

              {needsEndorsement && !editing && !draftEvent?.facultyCoordinatorId && (
                <div className="faculty-endorsement-banner">
                  <FacultyCoordinatorField
                    label="Designated faculty coordinator"
                    name="booking-faculty-coordinator"
                    value={facultyCoordinatorId}
                    onChange={setFacultyCoordinatorId}
                    required
                    hint="Your coordinator endorses the request before it moves to venue approvals."
                  />
                </div>
              )}

              {!editing && slot && eventTitle.length >= 3 && (
                <section className="allotment-review" aria-labelledby="booking-summary-title">
                  <h3 id="booking-summary-title">Booking summary</h3>
                  <dl>
                    <div><dt>Event</dt><dd>{eventTitle}</dd></div>
                    <div><dt>Venue</dt><dd>{venue.name}</dd></div>
                    <div><dt>Organizer</dt><dd>{organizer ? `${organizer.firstName} ${organizer.lastName}` : 'Loading…'}</dd></div>
                    <div><dt>Date and time</dt><dd>{formatDate(slot.from)} · {formatTimeRange(slot.from, slot.to)}</dd></div>
                  </dl>
                  <h4>Required approvals</h4>
                  {approvalPreview.data ? (
                    <ol className="booking-approval-list">
                      {needsEndorsement && <li>Faculty coordinator endorsement</li>}
                      {approvalPreview.data.steps.map((step, index) => (
                        <li key={index}>
                          {ROLE_LABELS[step.requiredRole]} · {step.scopeType === 'VENUE_DEPARTMENT'
                            ? venue.department?.name : WORKFLOW_SCOPE_LABELS[step.scopeType]}
                        </li>
                      ))}
                    </ol>
                  ) : !approvalPreview.isError && <p>Loading approval steps…</p>}
                </section>
              )}
              {!editing && (approvalPreview.isError || teamQuery.isError) && (
                <Alert tone="danger" title="Could not load booking details">
                  {approvalPreview.error instanceof ApiError && <p>{approvalPreview.error.message}</p>}
                  <button type="button" className="inline-link" onClick={() => {
                    if (approvalPreview.isError) void approvalPreview.refetch();
                    if (teamQuery.isError) void teamQuery.refetch();
                  }}>Try again</button>
                </Alert>
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


function nextSlotAfterConflicts(setupMinutes: number, conflictEnds: string[], slot: VenueSlot) {
  const quarterHour = 15 * 60_000;
  const afterSetup = Math.max(...conflictEnds.map((end) => Date.parse(end))) + setupMinutes * 60_000;
  const from = new Date(Math.ceil(afterSetup / quarterHour) * quarterHour);
  const to = new Date(from.getTime() + slot.to.getTime() - slot.from.getTime());
  return from > slot.from && dateInputValue(to) === slot.date ? { from, to } : null;
}
