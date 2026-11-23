import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Buildings, CalendarBlank, MagnifyingGlass, MapPin, ProjectorScreen, Snowflake, Users } from '@phosphor-icons/react';
import { useAuth, usePageTitle } from '../auth';
import { Alert, Button, EmptyState, Skeleton } from '../components/ui';
import { api, type Venue } from '../lib/api';
import { addDays, dateKey, formatShortDay } from '../lib/datetime';
import { dayAvailability, dayScheduleOptions } from '../lib/slot-schedule';
import { parseBookingDate, readGuestCount } from '../lib/venue-slot';

const PAGE_SIZE = 9;
const FILTERS = [
  { id: 'all', label: 'All spaces', icon: Buildings },
  { id: 'ac', label: 'AC', icon: Snowflake, facility: 'ac' },
  { id: 'projector', label: 'Projector', icon: ProjectorScreen, facility: 'projector' },
  { id: '100', label: '100+ seats', icon: Users, capacity: 100 },
  { id: '300', label: '300+ seats', icon: Users, capacity: 300 },
];

function CatalogCard({ venue, search, availability, failed, day }: {
  venue: Venue;
  search: string;
  availability?: ReturnType<typeof dayAvailability>;
  failed: boolean;
  day: string;
}) {
  const count = (availability?.open ?? 0) + (availability?.competing ?? 0);
  const state = availability ? count === 0 ? 'booked' : availability.open === 0 ? 'competing' : 'open' : 'unknown';
  const label = failed ? 'Availability unavailable' : !availability ? 'Checking availability…'
    : count === 0 ? `No slots ${day}`
      : availability.open === 0 ? `Requests pending ${day}`
        : count <= 3 ? `${count} ${count === 1 ? 'slot' : 'slots'} left ${day}` : `Available ${day}`;
  return (
    <article className="catalog-card">
      <div className="catalog-card-body">
        <span className="product-icon catalog-venue-icon"><Buildings size={25} aria-hidden="true" /></span>
        <h3><Link to={`/venues/${venue.id}?${search}`}>{venue.name}</Link></h3>
        <div className="catalog-meta">
          <span><MapPin size={16} aria-hidden="true" />{venue.building}</span>
          <span><Users size={17} aria-hidden="true" />{venue.capacity} seats</span>
        </div>
        {venue.facilities.length > 0 && <ul className="amenity-list">
          {venue.facilities.slice(0, 3).map((facility) => <li key={facility}>{facility}</li>)}
        </ul>}
        <div className="catalog-card-foot">
          <span className={`availability-label availability-${state}`}><i aria-hidden="true" />{label}</span>
          <Link className="catalog-open" to={`/venues/${venue.id}?${search}`} aria-label={`Check slots for ${venue.name}`}>
            Check slots <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function VenuesPage() {
  usePageTitle('Explore venues');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const today = new Date();
  const tomorrow = addDays(today, 1);
  const chosenDate = parseBookingDate(params.get('date'));
  const date = chosenDate && dateKey(chosenDate) >= dateKey(today) ? chosenDate : tomorrow;
  const dateValue = dateKey(date);
  const day = dateValue === dateKey(today) ? 'today' : dateValue === dateKey(tomorrow) ? 'tomorrow' : `on ${formatShortDay(date)}`;
  const search = params.get('q') ?? '';
  const building = params.get('building') ?? '';
  const filter = FILTERS.find(({ id }) => id === params.get('filter')) ?? FILTERS[0]!;
  const eventId = user?.status === 'ACTIVE' ? params.get('event') ?? params.get('eventId') ?? undefined : undefined;
  const guests = readGuestCount(params);
  const searchTerm = useDeferredValue(search.trim());
  const buildingTerm = useDeferredValue(building.trim());
  const minCapacity = Math.max(filter.capacity ?? 0, guests ?? 0) || undefined;

  const venues = useQuery({
    queryKey: ['venues', searchTerm, buildingTerm, filter.facility, minCapacity, eventId, offset],
    queryFn: () => api.venues({
      search: searchTerm, building: buildingTerm, facility: filter.facility, minCapacity,
      eventId, offset, limit: PAGE_SIZE,
    }),
  });
  const cards = venues.data?.venues ?? [];
  const availability = useQueries({ queries: cards.map(({ id }) => dayScheduleOptions(id, date)) });
  const total = venues.data?.total ?? 0;
  const detailParams = new URLSearchParams(params);
  detailParams.set('date', dateValue);

  function change(key: string, value: string) {
    setOffset(0);
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }

  return (
    <div className="product-page catalog-page">
      <section className="product-hero catalog-hero" aria-labelledby="catalog-title">
        <div className="product-hero-copy">
          <span className="hero-label"><MapPin size={16} aria-hidden="true" /> Campus spaces</span>
          <h1 id="catalog-title">Find your next space.</h1>
          <p>Book an auditorium, meeting room, or lab for your next campus event.</p>
        </div>
      </section>

      <section className="catalog-search" aria-label="Search and filter venues">
        <label className="catalog-search-field catalog-search-main">
          <MagnifyingGlass size={22} aria-hidden="true" />
          <span><strong>Search venues</strong><input type="search" value={search} maxLength={100}
            placeholder="Venue name or building" onChange={(event) => change('q', event.target.value)} /></span>
        </label>
        <label className="catalog-search-field">
          <CalendarBlank size={22} aria-hidden="true" />
          <span><strong>Date</strong><input type="date" value={dateValue} min={dateKey(today)}
            onChange={(event) => { if (event.target.value) change('date', event.target.value); }} /></span>
        </label>
        <label className="catalog-search-field">
          <Buildings size={22} aria-hidden="true" />
          <span><strong>Building</strong><input type="search" value={building} maxLength={100}
            placeholder="All buildings" onChange={(event) => change('building', event.target.value)} /></span>
        </label>
      </section>

      <section className="catalog-results" aria-labelledby="catalog-results-title">
        <div className="product-heading-row">
          <div><h2 id="catalog-results-title">Explore venues</h2>
            {venues.data && <p role="status">{total} {total === 1 ? 'space' : 'spaces'} · {formatShortDay(date)}</p>}
          </div>
          <div className="product-chips" aria-label="Venue filters">
            {FILTERS.map(({ id, label, icon: Icon }) => (
              <button type="button" key={id} aria-pressed={filter.id === id}
                onClick={() => change('filter', id === 'all' ? '' : id)}>
                <Icon size={17} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        </div>
        {venues.isError ? <Alert tone="danger" title="Could not load venues">
          <button type="button" className="inline-link" onClick={() => void venues.refetch()}>Try again</button>
        </Alert> : venues.isPending ? <div className="catalog-grid" role="status">
          <span className="sr-only">Finding venues…</span>
          {[0, 1, 2].map((item) => <Skeleton key={item} className="catalog-skeleton" />)}
        </div> : !cards.length ? <EmptyState icon={<MagnifyingGlass size={26} />} title={eventId && !minCapacity && !searchTerm && !buildingTerm && filter.id === 'all' ? 'No venues fit this event' : 'No venues found'}
          description="Try another search or clear a filter."
          action={<Button variant="secondary" onClick={() => {
            setOffset(0);
            setParams({ date: dateValue, ...(eventId ? { event: eventId } : {}) }, { replace: true });
          }}>Clear filters</Button>} /> : <div className="catalog-grid">
          {cards.map((venue, i) => (
            <CatalogCard key={venue.id} venue={venue} day={day}
              search={detailParams.toString()} failed={availability[i]?.isError ?? false}
              availability={availability[i]?.data && dayAvailability(date, venue, availability[i].data.entries)} />
          ))}
        </div>}
        {total > PAGE_SIZE && <div className="venue-pagination">
          <Button variant="secondary" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            <ArrowLeft size={16} /> Previous
          </Button>
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
          <Button variant="secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next <ArrowRight size={16} />
          </Button>
        </div>}
      </section>
    </div>
  );
}
