import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarBlank, MapPin, ShareNetwork, Users } from '@phosphor-icons/react';
import { DEFAULT_BOOKING_TITLE } from '@venue/shared';
import { useAuth, usePageTitle } from '../auth';
import { BookingSlotPicker } from '../components/BookingSlotPicker';
import { FacultyCoordinatorField } from '../components/FacultyCoordinatorField';
import { Alert, Button, EmptyState, Skeleton, TextareaField, TextField, useToast } from '../components/ui';
import { api, type EventSummary, type RequestDetailView, type Venue } from '../lib/api';
import { addDays, dateKey, formatShortDay, startOfDay, timeInputValue } from '../lib/datetime';
import { displaySlot } from '../lib/slot-schedule';
import { getVenueSlot, parseBookingDate, readGuestCount, readVenueSlot, venueAvailabilityOptions } from '../lib/venue-slot';

export function VenueDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const active = user?.status === 'ACTIVE';
  const editId = active ? params.get('editRequest') : null;
  const eventId = active ? params.get('eventId') ?? params.get('event') : null;
  const venue = useQuery({ queryKey: ['venue', id], queryFn: () => api.venue(id) });
  const request = useQuery({ queryKey: ['request', editId], queryFn: () => api.requestDetail(editId!), enabled: Boolean(editId) });
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => api.event(eventId!), enabled: Boolean(eventId && !editId) });
  usePageTitle(venue.data?.venue.name ?? 'Venue');

  if (venue.isPending || (editId && request.isPending) || (eventId && !editId && event.isPending)) {
    return <div className="product-page" role="status"><span className="sr-only">Loading venue</span><Skeleton className="detail-skeleton" /></div>;
  }
  if (!venue.data || (editId && !request.data?.permissions.canEdit) || (eventId && !editId && !event.data)) {
    return <div className="product-page"><EmptyState icon={<MapPin size={28} />}
      title={editId ? 'This booking cannot be modified' : 'Venue unavailable'}
      action={<Link className="btn btn-secondary btn-md" to={editId ? `/bookings/${editId}` : '/venues'}>Go back</Link>} /></div>;
  }

  return <VenueReservation key={[id, editId, eventId].join(':')} venue={venue.data.venue} params={params}
    edit={editId ? request.data : undefined} savedEvent={eventId && !editId ? event.data?.event : undefined} />;
}

function VenueReservation({ venue, params, edit, savedEvent }: {
  venue: Venue;
  params: URLSearchParams;
  edit?: RequestDetailView;
  savedEvent?: EventSummary;
}) {
  const { user, isApprover } = useAuth();
  const { pushToast } = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const pending = user?.status === 'PENDING_APPROVAL';
  const seedEvent = edit?.event ?? savedEvent;
  const originalStart = edit ? new Date(edit.request.startTime) : undefined;
  const originalEnd = edit ? new Date(edit.request.endTime) : undefined;
  const today = startOfDay(new Date());
  const inputDate = parseBookingDate(params.get('date'));
  const initialDate = inputDate && inputDate >= today ? inputDate : addDays(today, 1);
  const initialSlot = readVenueSlot(params);

  const [selection, setSelection] = useState({
    date: originalStart ? startOfDay(originalStart) : initialDate,
    start: originalStart ? timeInputValue(originalStart) : initialSlot?.start ?? '',
    end: originalEnd && originalStart && dateKey(originalStart) === dateKey(originalEnd)
      ? timeInputValue(originalEnd) : initialSlot?.end ?? '',
  });
  const [attendance, setAttendance] = useState(String(seedEvent?.expectedAttendance ?? readGuestCount(params) ?? 1));
  const [title, setTitle] = useState(seedEvent?.title === DEFAULT_BOOKING_TITLE ? '' : seedEvent?.title ?? '');
  const [description, setDescription] = useState(seedEvent?.description ?? '');
  const [faculty, setFaculty] = useState(seedEvent?.facultyCoordinatorId ?? '');
  const [formError, setFormError] = useState('');
  const attempt = useRef<{ details: string; key?: string }>(null);
  const needsFaculty = !edit && !isApprover && !savedEvent?.facultyCoordinatorId;
  const canChangeTime = edit?.request.status !== 'CONFIRMED';
  const unchanged = originalStart && originalEnd && dateKey(selection.date) === dateKey(originalStart) &&
    selection.start === timeInputValue(originalStart) &&
    selection.end === (dateKey(originalStart) === dateKey(originalEnd) ? timeInputValue(originalEnd) : '');
  const slot = unchanged ? {
    date: dateKey(selection.date), start: selection.start, end: selection.end, from: originalStart, to: originalEnd,
  } : getVenueSlot(dateKey(selection.date), selection.start, selection.end);
  const available = useQuery(venueAvailabilityOptions(
    pending || !canChangeTime ? undefined : venue.id, slot && slot.from > new Date() ? slot : null, edit?.request.id,
  ));
  const booked = available.data?.hasConfirmedConflict ?? false;
  const competing = available.data?.pendingConflicts.length ?? 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!slot) throw new Error('Choose a date and time');
      const timing = { venueId: venue.id, startTime: slot.from.toISOString(), endTime: slot.to.toISOString() };
      const event = { expectedAttendance: Number(attendance), description: description.trim(), facultyCoordinatorId: faculty || null };
      if (edit) return api.updateRequest(edit.request.id, {
        ...timing, event: { ...event, title: title.trim() || DEFAULT_BOOKING_TITLE },
      });
      const details = JSON.stringify([timing, savedEvent?.id, event, title.trim()]);
      if (attempt.current?.details !== details) attempt.current = { details, key: crypto.randomUUID?.() };
      const idempotencyKey = attempt.current.key;
      if (savedEvent) {
        if (needsFaculty) await api.setEventCoordinator(savedEvent.id, faculty);
        return api.createRequest({ ...timing, idempotencyKey, eventId: savedEvent.id });
      }
      return api.createRequest({ ...timing, idempotencyKey, event: { ...event, title: title.trim() || undefined } });
    },
    onSuccess: ({ request }) => {
      for (const key of ['my-events', 'venue-schedule', 'venue-calendar', 'venue-availability', 'request', 'approvals', 'approval']) {
        void client.invalidateQueries({ queryKey: [key] });
      }
      pushToast({ tone: 'success', title: edit ? 'Booking updated' : 'Booking request sent', message: venue.name });
      void navigate(`/bookings/${request.id}`, { replace: true });
    },
    onError: () => { void available.refetch(); },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    save.reset();
    if (!slot || (canChangeTime && slot.from <= new Date())) return setFormError('Choose a time in the future.');
    if (booked) return setFormError('This slot is booked. Choose another time.');
    if (needsFaculty && !faculty) return setFormError('Choose a faculty coordinator.');
    save.mutate();
  }

  async function share() {
    try {
      const url = new URL(`/venues/${venue.id}`, window.location.origin).href;
      if (navigator.share) await navigator.share({ title: venue.name, url });
      else {
        await navigator.clipboard.writeText(url);
        pushToast({ tone: 'success', title: 'Venue link copied' });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        pushToast({ tone: 'danger', title: 'Could not share this venue' });
      }
    }
  }

  return (
    <div className="product-page reservation-page">
      <div className="detail-breadcrumb">
        <Link className="text-link" to={edit ? `/bookings/${edit.request.id}` : `/venues?date=${dateKey(selection.date)}`}>
          <ArrowLeft size={18} aria-hidden="true" /> {edit ? 'Back to booking' : 'All venues'}
        </Link>
        <Button variant="secondary" size="sm" onClick={() => void share()}><ShareNetwork size={17} aria-hidden="true" /> Share</Button>
      </div>
      <div className="venue-heading">
        <h1>{venue.name}</h1>
        <div className="catalog-meta">
          <span><MapPin size={18} aria-hidden="true" /> {venue.building} · {venue.floor === 0 ? 'Ground floor' : `Floor ${venue.floor}`}</span>
          <span><Users size={19} aria-hidden="true" /> {venue.capacity} seats</span>
        </div>
        {venue.facilities.length > 0 && <ul className="amenity-list">
          {venue.facilities.map((item) => <li key={item}>{item}</li>)}
        </ul>}
      </div>
      <form className="reservation-layout" onSubmit={submit}>
        <div className="reservation-main">
          {canChangeTime && <BookingSlotPicker venue={venue} value={selection} onChange={(value) => {
            setSelection(value);
            setFormError('');
            save.reset();
          }} />}
          {!pending && <section className="product-panel reservation-fields">
            <h2>{savedEvent ? 'Event' : 'Booking details'}</h2>
            {savedEvent ? <p>{savedEvent.title} · {savedEvent.expectedAttendance} attendees</p> : <>
              <TextField label="Attendees" name="attendance" type="number" min={1} max={venue.capacity} required
                value={attendance} onChange={(event) => setAttendance(event.target.value)} />
              <TextField label="Event name" name="event-name" value={title} onChange={(event) => setTitle(event.target.value)}
                minLength={3} maxLength={200} optional placeholder="e.g. Design Club workshop" />
              <TextareaField label="Description" name="event-description" value={description}
                onChange={(event) => setDescription(event.target.value)} maxLength={2000} optional rows={2} />
            </>}
            {needsFaculty && <FacultyCoordinatorField label="Faculty coordinator" name="faculty-coordinator" value={faculty}
              onChange={setFaculty} required />}
          </section>}
        </div>
        <aside className="product-panel reservation-summary">
          <h2>{edit ? 'Modify booking' : 'Request this venue'}</h2>
          <div className="reservation-selection">
            <span className="product-icon"><CalendarBlank size={22} aria-hidden="true" /></span>
            <span><strong>{formatShortDay(selection.date)}</strong>
              <small>{slot ? displaySlot(slot.from, slot.to) : 'Choose a time'}</small></span>
          </div>
          {pending ? <Alert tone="info" title="Booking opens after approval">
            <Link className="inline-link" to="/register/pending">View account status</Link>
          </Alert> : <>
            {booked && <Alert tone="danger" title="This slot is booked" />}
            {!booked && competing > 0 && <Alert tone="warning" title={`${competing} competing ${competing === 1 ? 'request' : 'requests'}`} />}
            {(formError || save.error) && <Alert tone="danger" title={formError || save.error?.message || 'Could not save booking'} />}
            <Button className="btn-block" type="submit" size="lg" loading={save.isPending} disabled={!slot || booked || !venue.isActive}>
              {edit ? 'Save changes' : 'Request venue'} <ArrowRight size={19} aria-hidden="true" />
            </Button>
          </>}
        </aside>
      </form>
    </div>
  );
}
