import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  MagnifyingGlass,
  NotePencil,
  Plus,
  Prohibit,
  Storefront,
  X,
} from '@phosphor-icons/react';
import type { Venue } from '../lib/api';
import { api, ApiError } from '../lib/api';
import { usePageTitle } from '../auth';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';
import { VenueDialog } from '../components/VenueDialog';

const PAGE_SIZE = 25;
type ActiveFilter = 'all' | 'active' | 'archived';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'all', label: 'All venues' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export function AdminVenuesPage() {
  usePageTitle('Venue management');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [offset, setOffset] = useState(0);
  const [dialogTarget, setDialogTarget] = useState<{ venue?: Venue } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Venue | null>(null);
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: api.departments,
    staleTime: 5 * 60_000,
  });

  const venues = useQuery({
    queryKey: ['admin', 'venues', { search: deferredSearch, activeFilter, offset }],
    queryFn: () =>
      api.adminVenues({
        search: deferredSearch || undefined,
        active: activeFilter === 'all' ? undefined : activeFilter === 'active',
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
  });

  const total = venues.data?.total ?? 0;
  const rows = venues.data?.venues ?? [];
  const hasFilters = Boolean(search || activeFilter !== 'all');

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'venues'] }),
      queryClient.invalidateQueries({ queryKey: ['venues'] }),
      queryClient.invalidateQueries({ queryKey: ['venue'] }),
      queryClient.invalidateQueries({ queryKey: ['venue-calendar'] }),
    ]);
  }

  const archive = useMutation({
    mutationFn: (venue: Venue) => api.archiveVenue(venue.id),
    onSuccess: async (result) => {
      await refresh();
      setArchiveTarget(null);
      pushToast({ tone: 'success', title: 'Venue archived', message: `${result.venue.name} is hidden from new requests.` });
    },
  });

  const restore = useMutation({
    mutationFn: (venue: Venue) => api.updateVenue(venue.id, { isActive: true }),
    onSuccess: async (result) => {
      await refresh();
      pushToast({ tone: 'success', title: 'Venue restored', message: `${result.venue.name} is available again.` });
    },
  });

  return (
    <>
      <PageHeader
        title="Manage venues"
        description="Maintain venue capacity, facilities, reservation buffers and workflow assignments."
        actions={
          <Button onClick={() => setDialogTarget({})}>
            <Plus size={17} aria-hidden="true" /> Add venue
          </Button>
        }
      />

      <div className="directory-card">
        <div className="directory-toolbar">
          <div className="filter-tabs" role="group" aria-label="Venue availability">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={activeFilter === option.value}
                className={`filter-tab ${activeFilter === option.value ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveFilter(option.value);
                  setOffset(0);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="search-field">
            <MagnifyingGlass size={17} className="search-icon" aria-hidden="true" />
            <label className="sr-only" htmlFor="admin-venue-search">
              Search venues by name, code or building
            </label>
            <input
              id="admin-venue-search"
              type="search"
              className="input search-input"
              placeholder="Search name, code or building"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setSearch('');
                  setOffset(0);
                }}
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {venues.isError ? (
          <div className="page-alert venue-table-alert">
            <Alert tone="danger" title="Could not load venues">
              Check your connection and{' '}
              <button type="button" className="inline-link" onClick={() => void venues.refetch()}>
                try again
              </button>
              .
            </Alert>
          </div>
        ) : venues.isPending ? (
          <div className="venue-table-loading" aria-hidden="true">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton className="skeleton-line skeleton-line-wide" key={item} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Storefront size={28} weight="duotone" />}
            title={hasFilters ? 'No venues match those filters' : 'No venues yet'}
            description={
              hasFilters
                ? 'Try a different search term or availability filter.'
                : 'Add the first venue so students and faculty can request it.'
            }
            action={
              hasFilters ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setActiveFilter('all');
                    setOffset(0);
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" onClick={() => setDialogTarget({})}>
                  <Plus size={15} /> Add venue
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className={`table-scroll ${venues.isFetching ? 'is-refreshing' : ''}`}>
              <table className="data-table venue-table">
                <thead>
                  <tr>
                    <th>Venue</th>
                    <th>Location</th>
                    <th>Department</th>
                    <th>Capacity</th>
                    <th>Buffers</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((venue) => (
                    <tr key={venue.id}>
                      <td data-label="Venue">
                        <span className="table-venue-cell">
                          <strong>{venue.name}</strong>
                          <span>{venue.code}</span>
                        </span>
                      </td>
                      <td data-label="Location">
                        <span className="table-muted">
                          {venue.building} · Floor {venue.floor}
                        </span>
                      </td>
                      <td data-label="Department">
                        <span className="department-tag">{venue.department?.code ?? 'COMMON'}</span>
                      </td>
                      <td data-label="Capacity">{venue.capacity}</td>
                      <td data-label="Buffers">
                        {venue.setupBufferMins}m / {venue.teardownBufferMins}m
                      </td>
                      <td data-label="Status">
                        <span
                          className={`venue-availability ${venue.isActive ? 'is-open' : 'is-closed'}`}
                        >
                          {venue.isActive ? 'Available' : 'Archived'}
                        </span>
                      </td>
                      <td data-label="Actions">
                        <span className="table-actions">
                          <Link to={`/venues/${venue.id}`} className="btn btn-ghost btn-sm">
                            View
                          </Link>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setDialogTarget({ venue })}
                          >
                            <NotePencil size={14} /> Edit
                          </Button>
                          {venue.isActive ? (
                            <Button
                              variant="danger-ghost"
                              size="sm"
                              onClick={() => {
                                archive.reset();
                                setArchiveTarget(venue);
                              }}
                            >
                              <Prohibit size={14} /> Archive
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={restore.isPending}
                              onClick={() => restore.mutate(venue)}
                            >
                              Restore
                            </Button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <p>
                {total} venue{total === 1 ? '' : 's'}
                {hasFilters ? ' matching filters' : ''}
              </p>
              {total > PAGE_SIZE && (
                <div className="pagination">
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
            </div>
          </>
        )}
      </div>

      {dialogTarget && (
        <VenueDialog
          venue={dialogTarget.venue}
          departments={departments.data?.departments ?? []}
          onClose={() => setDialogTarget(null)}
        />
      )}

      <Dialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        title="Archive this venue?"
        description="Existing bookings stay in history. The venue disappears from discovery and cannot receive new requests."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setArchiveTarget(null)}>
              Keep available
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={archive.isPending}
              onClick={() => archiveTarget && archive.mutate(archiveTarget)}
            >
              Archive venue
            </Button>
          </>
        }
      >
        <p className="dialog-confirm-copy">
          {archiveTarget?.name} ({archiveTarget?.code}) will be marked as archived.
        </p>
        {archive.isError && (
          <Alert tone="danger" title="Could not archive venue">
            {archive.error instanceof ApiError ? archive.error.message : 'Try again.'}
          </Alert>
        )}
      </Dialog>
    </>
  );
}
