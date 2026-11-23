import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Buildings, MagnifyingGlass, UsersThree } from '@phosphor-icons/react';
import { VENUE_STATUS_LABELS } from '@venue/shared';
import { useAuth, usePageTitle } from '../auth';
import { Alert, Avatar, Button, EmptyState, RoleBadge, Skeleton, StatusBadge, TextField } from '../components/ui';
import { api } from '../lib/api';

const PAGE_SIZE = 18;
const TABS = [{ id: 'members', label: 'Users' }, { id: 'venues', label: 'Venues' }] as const;

export function DepartmentPage() {
  const department = useAuth().user!.department;
  usePageTitle(department.name);
  const [view, setView] = useState<(typeof TABS)[number]['id']>('members');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const term = useDeferredValue(search.trim());
  const directory = useQuery({
    queryKey: ['department', department.id, view, term, offset],
    queryFn: ({ signal }) => api.departmentDirectory(department.id, view, { search: term, limit: PAGE_SIZE, offset }, signal),
  });
  const results = directory.data;
  const total = results?.total ?? 0;

  return <div className="product-page">
    <div className="product-page-heading"><div><h1>{department.name}</h1><p>Department directory</p></div></div>
    <div className="product-heading-row">
      <div className="product-chips" aria-label="Department directory">
        {TABS.map(({ id, label }) => <button type="button" key={id} aria-pressed={id === view} onClick={() => {
          setView(id);
          setSearch('');
          setOffset(0);
        }}>{label}</button>)}
      </div>
      <TextField name="department-search" label={view === 'members' ? 'Search users' : 'Search venues'} type="search"
        value={search} maxLength={100} leadingIcon={<MagnifyingGlass size={17} aria-hidden="true" />}
        onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
    </div>
    {directory.isError ? <Alert tone="danger" title="Could not load the directory">
      <button type="button" className="inline-link" onClick={() => void directory.refetch()}>Try again</button>
    </Alert> : directory.isPending ? <div className="product-grid" role="status">
      <span className="sr-only">Loading the directory</span><Skeleton className="skeleton-block" />
    </div> : !total ? <div className="product-panel"><EmptyState icon={view === 'members' ? <UsersThree size={26} /> : <Buildings size={26} />}
      title={view === 'members' ? 'No department users found' : 'No department venues found'} /></div> : <div className="product-grid">
      {results && 'members' in results && results.members.map((member) => <article key={member.id} className="product-panel admin-record">
        <div className="user-cell">
          <Avatar firstName={member.firstName} lastName={member.lastName} size="md" />
          <div><strong>{member.firstName} {member.lastName}</strong><span>{member.email}</span></div>
        </div>
        <div className="product-heading-row">
          <div className="role-stack">{member.roles.map((role) => <RoleBadge key={role} role={role} />)}</div>
          <StatusBadge status={member.status} />
        </div>
      </article>)}
      {results && 'venues' in results && results.venues.map((venue) => <article key={venue.id} className="product-panel admin-record">
        <div><h2>{venue.name}</h2><p>{venue.building} · {venue.capacity} seats</p></div>
        <p>{venue.code} · {VENUE_STATUS_LABELS[venue.status]}</p>
      </article>)}
    </div>}
    {(offset > 0 || total > PAGE_SIZE) && <div className="venue-pagination">
      <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ArrowLeft size={17} /> Previous</Button>
      <span>Page {Math.floor(offset / PAGE_SIZE) + 1}</span>
      <Button variant="secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next <ArrowRight size={17} /></Button>
    </div>}
  </div>;
}
