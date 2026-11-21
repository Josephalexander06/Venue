import { useDeferredValue, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, MagnifyingGlass, X } from '@phosphor-icons/react';
import { usePageTitle } from '../auth';
import { BookingDateField } from '../components/BookingDateField';
import { VenueListItem, type VenueAvailabilityState } from '../components/booking';
import { Alert, Button, EmptyState, PageHeader, SelectField, Skeleton, TextField } from '../components/ui';
import { api, type Availability } from '../lib/api';
import { addDays, dateInputValue, formatLongDay, formatTimeRange } from '../lib/datetime';
import { getVenueSlot, readGuestCount, readVenueSlot, venueAvailabilityOptions } from '../lib/venue-slot';

const PAGE_SIZE = 8;
const AVAILABILITY_ORDER: Record<VenueAvailabilityState, number> = {
  open: 0,
  competing: 1,
  checking: 2,
  unknown: 3,
  booked: 4,
};

function availabilityState(data: Availability | undefined, failed: boolean): VenueAvailabilityState {
  if (failed) return 'unknown';
  if (!data) return 'checking';
  if (data.hasConfirmedConflict) return 'booked';
  return data.pendingConflicts.length > 0 ? 'competing' : 'open';
}

export function VenuesPage() {
  usePageTitle('Browse venues');
  const [params, setParams] = useSearchParams();
  const eventId = params.get('eventId');
  const search = params.get('q') ?? '';
  const departmentId = params.get('department') ?? '';
  const building = params.get('building') ?? '';
  const facility = params.get('facility') ?? '';
  const guestFilter = eventId ? null : readGuestCount(params);
  const proposedSlot = readVenueSlot(params);
  const checkedSlot = proposedSlot && proposedSlot.from >= new Date() ? proposedSlot : null;
  const availableDuring = params.get('available') === '1' ? checkedSlot : null;

  const deferredSearch = useDeferredValue(search.trim());
  const deferredBuilding = useDeferredValue(building.trim());
  const deferredFacility = useDeferredValue(facility.trim());
  const [date, setDate] = useState(() => checkedSlot?.date ?? dateInputValue(addDays(new Date(), 1)));
  const [start, setStart] = useState(checkedSlot?.start ?? '10:00');
  const [end, setEnd] = useState(checkedSlot?.end ?? '12:00');
  const [guests, setGuests] = useState(guestFilter ? String(guestFilter) : '');
  const [timeError, setTimeError] = useState('');
  const [offset, setOffset] = useState(0);

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: api.departments,
    staleTime: 5 * 60_000,
  });

  const eventQuery = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.event(eventId!),
    enabled: Boolean(eventId),
  });
  const savedEvent = eventQuery.data?.event;
  const minCapacity = savedEvent?.expectedAttendance ?? guestFilter;

  const venues = useQuery({
    queryKey: ['venues', {
      eventId, search: deferredSearch, departmentId, minCapacity, offset,
      building: deferredBuilding, facility: deferredFacility,
      from: availableDuring?.from, to: availableDuring?.to,
    }],
    enabled: !eventId || Boolean(savedEvent),
    queryFn: () =>
      api.venues({
        active: true,
        eventId: eventId ?? undefined,
        search: deferredSearch || undefined,
        building: deferredBuilding || undefined,
        facility: deferredFacility || undefined,
        from: availableDuring?.from.toISOString(),
        to: availableDuring?.to.toISOString(),
        departmentId: departmentId || undefined,
        minCapacity: minCapacity ?? undefined,
        limit: PAGE_SIZE,
        offset,
      }),
  });

  const total = venues.data?.total ?? 0;
  const visible = (venues.data?.venues ?? []).filter((venue) => venue.capacity >= (minCapacity ?? 0));
  const availability = useQueries({
    queries: checkedSlot ? visible.map((venue) => venueAvailabilityOptions(venue.id, checkedSlot)) : [],
  });

  const cards = visible.map((venue, index) => ({
    venue,
    state: checkedSlot ? availabilityState(availability[index]?.data, availability[index]?.isError ?? false) : undefined,
  }));
  const checking = cards.some(({ state }) => state === 'checking');
  const failedChecks = availability.filter((query) => query.isError);
  if (checkedSlot && !checking) {
    cards.sort((left, right) => AVAILABILITY_ORDER[left.state!] - AVAILABILITY_ORDER[right.state!]);
  }
  const canRequestCount = cards.filter(({ state }) => state === 'open' || state === 'competing').length;
  const hasFilters = Boolean(search || departmentId || guestFilter || building || facility || availableDuring);

  function changeFilter(name: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    }, { replace: true });
    setOffset(0);
  }

  function clearFilters() {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const filter of ['q', 'department', 'guests', 'building', 'facility', 'available']) next.delete(filter);
      return next;
    }, { replace: true });
    setGuests('');
    setOffset(0);
  }

  function checkSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slot = getVenueSlot(date, start, end);
    if (!slot) {
      setTimeError('Choose an end time after the start time.');
      return;
    }
    if (slot.from < new Date()) {
      setTimeError('Choose a start time in the future.');
      return;
    }
    setTimeError('');
    setOffset(0);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('date', date);
      next.set('start', start);
      next.set('end', end);
      if (!eventId && guests) next.set('guests', guests);
      else next.delete('guests');
      return next;
    }, { replace: true });
    if (offset === 0 && (eventId || guests === String(guestFilter ?? '')) &&
      checkedSlot?.from.getTime() === slot.from.getTime() && checkedSlot.to.getTime() === slot.to.getTime()) {
      if (availableDuring) void venues.refetch();
      for (const query of availability) void query.refetch();
    }
  }

  return (
    <>
      <section className="venue-search-panel" aria-label="Find a venue by date and time">
        <PageHeader
          title="Find the right space"
          description={savedEvent
            ? `${savedEvent.title} · ${savedEvent.expectedAttendance} expected attendees`
            : eventId ? 'Check a date and time for your saved event.'
              : 'Choose a date and time, then compare spaces for your event.'}
          actions={<Link to="/my-events" className="text-link venue-search-events">My events <ArrowRight size={16} aria-hidden="true" /></Link>}
        />
        <form className={eventId ? 'venue-slot-form venue-slot-form-event' : 'venue-slot-form'} onSubmit={checkSlot}>
          <BookingDateField label="Event date" name="venue-date" value={date} onChange={(value) => { setDate(value); setTimeError(''); }} />
          <TextField label="Start time" name="venue-start" type="time" value={start} onChange={(event) => {
            setStart(event.target.value);
            setTimeError('');
          }} required />
          <TextField label="End time" name="venue-end" type="time" value={end} onChange={(event) => {
            setEnd(event.target.value);
            setTimeError('');
          }} required />
          {!eventId && (
            <TextField label="Guests" name="venue-guests" type="number" min={1} max={100_000}
              placeholder="Any" value={guests} onChange={(event) => setGuests(event.target.value)} optional />
          )}
          <Button type="submit" size="lg" className="venue-slot-submit">
            <MagnifyingGlass size={19} aria-hidden="true" /> Check availability
          </Button>
          {timeError && <p className="venue-slot-error" role="alert">{timeError}</p>}
        </form>
      </section>

      <section className="venue-catalog" aria-labelledby="venues-heading">
        <div className="venue-catalog-head">
          <div>
            <h2 id="venues-heading">Campus venues</h2>
            <p role="status">
              {checkedSlot
                ? <>{formatLongDay(checkedSlot.from)} · {formatTimeRange(checkedSlot.from, checkedSlot.to)}{minCapacity && ` · ${minCapacity} guests`}</>
                : savedEvent ? `Showing spaces for at least ${savedEvent.expectedAttendance} people.`
                  : 'Browse all spaces accepting requests.'}
            </p>
            {checkedSlot && (
              <label className="venue-availability-filter">
                <input type="checkbox" checked={Boolean(availableDuring)}
                  onChange={(event) => changeFilter('available', event.target.checked ? '1' : '')} />
                Hide fully booked venues
              </label>
            )}
          </div>
          <div className="venue-catalog-filters" aria-label="Venue filters">
            <TextField label="Search venues" name="venue-search" type="search" value={search}
              onChange={(event) => changeFilter('q', event.target.value)} maxLength={100}
              placeholder="Name, code or building" leadingIcon={<MagnifyingGlass size={17} />}
              trailing={search && (
                <button type="button" className="field-action" aria-label="Clear search" onClick={() => changeFilter('q', '')}>
                  <X size={15} aria-hidden="true" />
                </button>
              )} />
            <SelectField label="Department" name="venue-department" value={departmentId}
              onChange={(event) => changeFilter('department', event.target.value)}>
              <option value="">All departments</option>
              {departments.data?.departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </SelectField>
            <TextField label="Building" name="venue-building" type="search" value={building}
              onChange={(event) => changeFilter('building', event.target.value)} maxLength={100}
              placeholder="Any building" />
            <TextField label="Facility" name="venue-facility" type="search" value={facility}
              onChange={(event) => changeFilter('facility', event.target.value)} maxLength={100}
              placeholder="e.g. Projector" />
          </div>
        </div>

        {eventId && eventQuery.isError && !savedEvent ? (
          <Alert tone="danger" title="Could not load the saved event">
            <button type="button" className="inline-link" onClick={() => void eventQuery.refetch()}>Try again</button>
          </Alert>
        ) : venues.isError ? (
          <Alert tone="danger" title="Could not load venues">
            <button type="button" className="inline-link" onClick={() => void venues.refetch()}>Try again</button>
          </Alert>
        ) : venues.isPending ? (
          <div className="venue-cards-skeleton" role="status">
            <span className="sr-only">Finding venues…</span>
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="skeleton-block" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<MagnifyingGlass size={26} />}
              title={hasFilters ? 'No venues match these filters'
                : savedEvent ? 'No venues fit this event' : 'No venues accepting requests'}
              description={hasFilters
                ? 'Try a different date or clear the filters.'
                : savedEvent ? `No available venue can hold ${savedEvent.expectedAttendance} people.`
                  : 'Check the venue catalog again later.'}
              action={hasFilters && <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
            />
          </div>
        ) : (
          <>
            <div className="venue-results-summary" role="status">
              <span>
                <strong>{total} {total === 1 ? 'space' : 'spaces'}</strong>
                {checkedSlot && (checking ? ' · Checking availability…'
                  : failedChecks.length < cards.length
                    ? ` · ${canRequestCount} can be requested${total > PAGE_SIZE ? ' on this page' : ''}`
                    : '')}
              </span>
              {checkedSlot && !checking && failedChecks.length === 0 && canRequestCount === 0 && (
                <span>Try another date or time.</span>
              )}
              {failedChecks.length > 0 && (
                <button type="button" className="inline-link" onClick={() => {
                  for (const query of failedChecks) void query.refetch();
                }}>Retry availability checks</button>
              )}
            </div>

            <ul className="venue-results" aria-label="Matching venues">
              {cards.map(({ venue, state }) => (
                <VenueListItem key={venue.id} venue={venue} search={params.toString()} availability={state} />
              ))}
            </ul>

            {total > PAGE_SIZE && (
              <div className="venue-pagination">
                <Button variant="secondary" size="sm" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  <ArrowLeft size={15} aria-hidden="true" /> Previous
                </Button>
                <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
                <Button variant="secondary" size="sm" disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Next <ArrowRight size={15} aria-hidden="true" />
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
