import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CalendarBlank,
  MagnifyingGlass,
  SlidersHorizontal,
  X,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { usePageTitle } from '../auth';
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  SelectField,
  Skeleton,
  TextField,
} from '../components/ui';
import { VenueListItem } from '../components/booking';

const PAGE_SIZE = 12;
const CAPACITY_OPTIONS = [
  { value: '', label: 'Any capacity' },
  { value: '30', label: '30+ people' },
  { value: '60', label: '60+ people' },
  { value: '120', label: '120+ people' },
  { value: '250', label: '250+ people' },
];

export function VenuesPage() {
  usePageTitle('Browse venues');
  const [params] = useSearchParams();
  const eventId = params.get('eventId');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [departmentId, setDepartmentId] = useState('');
  const [minCapacity, setMinCapacity] = useState('');
  const [offset, setOffset] = useState(0);

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: api.departments,
    staleTime: 5 * 60_000,
  });

  const venues = useQuery({
    queryKey: ['venues', { search: deferredSearch, departmentId, minCapacity, offset }],
    queryFn: () =>
      api.venues({
        active: true,
        search: deferredSearch || undefined,
        departmentId: departmentId || undefined,
        minCapacity: minCapacity ? Number(minCapacity) : undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
  });

  const total = venues.data?.total ?? 0;
  const visible = venues.data?.venues ?? [];
  const hasFilters = Boolean(search || departmentId || minCapacity);

  function resetPage() {
    setOffset(0);
  }

  return (
    <>
      <PageHeader
        title="Find the right space"
        description={eventId
          ? 'Choose a venue and an available slot for your event.'
          : 'Compare campus spaces by location, capacity and facilities, then check their calendars.'}
        actions={
          <Link to="/my-events" className="btn btn-secondary btn-md">
            <CalendarBlank size={17} /> My events
          </Link>
        }
      />

      <section className="venue-filter-card" aria-label="Venue filters">
        <TextField
          label="Search venues"
          name="venue-search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            resetPage();
          }}
          placeholder="Name, code or building"
          className="search-input"
          leadingIcon={<MagnifyingGlass size={17} />}
          trailing={
            search ? (
              <button
                type="button"
                className="field-action"
                aria-label="Clear search"
                onClick={() => {
                  setSearch('');
                  resetPage();
                }}
              >
                <X size={15} />
              </button>
            ) : undefined
          }
        />
        <SelectField
          label="Department"
          name="venue-department"
          value={departmentId}
          onChange={(event) => {
            setDepartmentId(event.target.value);
            resetPage();
          }}
        >
          <option value="">All departments</option>
          {departments.data?.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Capacity"
          name="venue-capacity"
          value={minCapacity}
          onChange={(event) => {
            setMinCapacity(event.target.value);
            resetPage();
          }}
        >
          {CAPACITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="venue-filter-reset"
            onClick={() => {
              setSearch('');
              setDepartmentId('');
              setMinCapacity('');
              resetPage();
            }}
          >
            <SlidersHorizontal size={15} /> Reset filters
          </Button>
        )}
      </section>

      {venues.isError && (
        <div className="page-alert">
          <Alert tone="danger" title="Could not load venues">
            Check your connection and{' '}
            <button type="button" className="inline-link" onClick={() => void venues.refetch()}>
              try again
            </button>
            .
          </Alert>
        </div>
      )}

      <div className="venue-results-head" role="status">
        <p>
          {!venues.isError && (venues.isPending
            ? 'Finding venues…'
            : `${total} ${total === 1 ? 'venue' : 'venues'}${hasFilters ? ' matching your filters' : ' accepting requests'}`)}
        </p>
        {venues.isFetching && !venues.isPending && <span className="refreshing-note">Updating…</span>}
      </div>

      {venues.isPending ? (
        <div className="card table-skeleton" role="status">
          <span className="sr-only">Loading venues</span>
          {[0, 1, 2].map((item) => (
            <div className="table-skeleton-row" key={item} aria-hidden="true">
              <Skeleton className="skeleton-line skeleton-line-wide" />
              <Skeleton className="skeleton-line" />
            </div>
          ))}
        </div>
      ) : venues.isError && !venues.data ? null : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<MagnifyingGlass size={28} weight="duotone" />}
            title={hasFilters ? 'No venues match these filters' : 'No venues accepting requests'}
            description={hasFilters ? "Try a lower capacity, another department or a different search term." : "Check the catalog again later or contact your college administrator."}
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setDepartmentId('');
                    setMinCapacity('');
                    resetPage();
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <section className="venue-results" aria-label="Venues accepting requests">
            <div className="venue-result venue-result-head" aria-hidden="true">
              <span>Venue</span><span>Location</span><span>Capacity</span><span>Facilities</span><span />
            </div>
            <ul>
              {visible.map((venue) => (
                <VenueListItem key={venue.id} venue={venue} eventId={eventId} />
              ))}
            </ul>
          </section>
          {total > PAGE_SIZE && (
            <div className="venue-pagination">
              <Button
                variant="secondary"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ArrowLeft size={15} /> Previous
              </Button>
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next <ArrowRight size={15} />
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
