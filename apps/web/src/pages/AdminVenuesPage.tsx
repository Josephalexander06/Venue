import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Buildings, NotePencil, Plus } from '@phosphor-icons/react';
import { VENUE_STATUSES, VENUE_STATUS_LABELS, type VenueStatus } from '@venue/shared';
import { usePageTitle } from '../auth';
import { Alert, Button, Dialog, EmptyState, SelectField, Skeleton, TextField, useToast } from '../components/ui';
import { VenueDialog } from '../components/VenueDialog';
import { api, type Venue } from '../lib/api';

const PAGE_SIZE = 18;
const FILTERS = ['ALL', ...VENUE_STATUSES] as const;

export function AdminVenuesPage() {
  usePageTitle('Manage venues');
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((item) => item === params.get('status')) ?? 'ALL';
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [offset, setOffset] = useState(0);
  const [editor, setEditor] = useState<{ venue?: Venue }>();
  const [confirm, setConfirm] = useState<{ venue: Venue; status: VenueStatus }>();
  const client = useQueryClient();
  const { pushToast } = useToast();

  const departments = useQuery({ queryKey: ['departments'], queryFn: api.departments, enabled: Boolean(editor) });
  const venues = useQuery({
    queryKey: ['admin', 'venues', term, filter, offset],
    queryFn: () => api.adminVenues({ search: term, status: filter === 'ALL' ? undefined : filter, limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData,
  });
  const total = venues.data?.total ?? 0;
  const change = useMutation({
    mutationFn: ({ venue, status }: { venue: Venue; status: VenueStatus }) => api.updateVenue(venue.id, { status }),
    onSuccess: ({ venue }) => {
      setConfirm(undefined);
      for (const key of [['admin', 'venues'], ['venues'], ['venue'], ['venue-schedule'], ['venue-calendar'], ['venue-availability']]) {
        void client.invalidateQueries({ queryKey: key });
      }
      pushToast({ tone: 'success', title: 'Venue status updated', message: `${venue.name} · ${VENUE_STATUS_LABELS[venue.status]}` });
    },
    onError: (error) => { pushToast({ tone: 'danger', title: 'Could not update venue', message: error.message }); },
  });

  return <div className="product-page">
    <div className="product-page-heading"><h1>Manage venues</h1>
      <Button size="lg" onClick={() => setEditor({})}><Plus size={18} /> Add venue</Button></div>
    <div className="product-heading-row">
      <div className="product-chips" aria-label="Filter by venue status">
        {FILTERS.map((item) => <button type="button" key={item} aria-pressed={filter === item}
          onClick={() => { setOffset(0); setParams(item === 'ALL' ? {} : { status: item }); }}>
          {item === 'ALL' ? 'All venues' : VENUE_STATUS_LABELS[item]}
        </button>)}
      </div>
      <TextField label="Search venues" name="manage-venue-search" type="search" value={search} placeholder="Name, code or building"
        onChange={(event) => { setOffset(0); setSearch(event.target.value); }} />
    </div>
    {venues.isError ? <Alert tone="danger" title="Could not load venues">
      <button className="inline-link" type="button" onClick={() => void venues.refetch()}>Try again</button>
    </Alert> : venues.isPending ? <div className="product-grid" role="status">
      <span className="sr-only">Loading venues</span><Skeleton className="skeleton-block" /><Skeleton className="skeleton-block" />
    </div> : !venues.data?.venues.length ? <div className="product-panel">
      <EmptyState icon={<Buildings size={28} />} title="No venues found" />
    </div> : <div className="product-grid">
      {venues.data.venues.map((venue) => <article className="product-panel admin-record" key={venue.id}>
        <div><h2>{venue.name}</h2><p>{venue.code} · {venue.building} · {venue.capacity} seats</p></div>
        <SelectField label="Booking status" name={`venue-status-${venue.id}`} value={venue.status}
          disabled={change.isPending} onChange={(event) => {
            const status = event.target.value as VenueStatus;
            if (status === 'ACTIVE') change.mutate({ venue, status });
            else { change.reset(); setConfirm({ venue, status }); }
          }}>
          {VENUE_STATUSES.map((status) => <option key={status} value={status}>{VENUE_STATUS_LABELS[status]}</option>)}
        </SelectField>
        <div className="product-actions">
          <Button variant="secondary" size="sm" onClick={() => setEditor({ venue })}><NotePencil size={17} /> Edit</Button>
          <Link className="btn btn-ghost btn-sm" to={`/venues/${venue.id}`}>View venue <ArrowRight size={16} /></Link>
        </div>
      </article>)}
    </div>}
    {(offset > 0 || total > PAGE_SIZE) && <div className="venue-pagination">
      <Button variant="secondary" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ArrowLeft size={16} /> Previous</Button>
      <span>{total ? offset + 1 : 0}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
      <Button variant="secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next <ArrowRight size={16} /></Button>
    </div>}
    {editor && <VenueDialog venue={editor.venue} departments={departments.data?.departments ?? []} onClose={() => setEditor(undefined)} />}
    {confirm && <Dialog open onClose={() => { if (!change.isPending) setConfirm(undefined); }}
      title={`Mark venue as ${VENUE_STATUS_LABELS[confirm.status].toLowerCase()}?`}
      description={`${confirm.venue.name} will stop accepting new bookings.`}
      footer={<>
        <Button variant="ghost" onClick={() => setConfirm(undefined)} disabled={change.isPending}>Cancel</Button>
        <Button onClick={() => change.mutate(confirm)} loading={change.isPending}>Update status</Button>
      </>}>{change.error && <Alert tone="danger" title={change.error.message} />}</Dialog>}
  </div>;
}
