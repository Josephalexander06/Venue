import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Buildings, ClipboardText, ListChecks, UsersThree, Wrench } from '@phosphor-icons/react';
import { usePageTitle } from '../auth';
import { APPROVAL_PREVIEW_KEY } from '../components/AppShell';
import { Alert, Button, Skeleton } from '../components/ui';
import { UserReviewDialog } from '../components/UserReviewDialog';
import { api, type UserView } from '../lib/api';

export function AdminOverviewPage() {
  usePageTitle('Administration');
  const [reviewing, setReviewing] = useState<UserView>();
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: api.adminStats, staleTime: 15_000 });
  const maintenance = useQuery({
    queryKey: ['admin', 'venues', 'maintenance-preview'],
    queryFn: () => api.adminVenues({ status: 'MAINTENANCE', limit: 4 }),
  });
  const inbox = useQuery({
    queryKey: APPROVAL_PREVIEW_KEY, queryFn: () => api.approvalInbox({ limit: 3 }), staleTime: 15_000,
  });
  const pending = stats.data?.counts.PENDING_APPROVAL ?? 0;
  const tools = [
    { to: '/admin/users', label: 'Users', count: pending ? `${pending} pending` : undefined, icon: UsersThree },
    { to: '/admin/venues', label: 'Venues', icon: Buildings },
    { to: '/admin/departments', label: 'Departments', icon: ClipboardText },
    { to: '/admin/workflows', label: 'Approval steps', icon: ListChecks },
  ];

  return <div className="product-page admin-page">
    <div className="product-page-heading"><h1>Administration</h1></div>
    <nav className="product-grid" aria-label="Administration">
      {tools.map(({ to, label, icon: Icon, count }) => <Link key={to} to={to} className="product-panel admin-tile">
        <span className="product-icon"><Icon size={23} aria-hidden="true" /></span>
        <span><strong>{label}</strong>{count && <small>{count}</small>}</span><ArrowRight size={18} aria-hidden="true" />
      </Link>)}
    </nav>
    {stats.isError && <Alert tone="danger" title="Could not load pending registrations">
      <button className="inline-link" type="button" onClick={() => void stats.refetch()}>Try again</button>
    </Alert>}
    <section className="product-section">
      <div className="product-heading-row"><h2>Pending registrations</h2>
        <Link className="text-link" to="/admin/users?status=PENDING_APPROVAL">View queue <ArrowRight size={16} /></Link>
      </div>
      {stats.isPending ? <Skeleton className="skeleton-block" /> : stats.data && (
        stats.data.recentPending.length ? <ul className="admin-list">{stats.data.recentPending.map((user) => (
          <li className="product-panel admin-list-item" key={user.id}>
            <div><strong>{user.firstName} {user.lastName}</strong><p>{user.email}</p></div>
            <Button variant="secondary" onClick={() => setReviewing(user)}>Review</Button>
          </li>
        ))}</ul> : <div className="product-panel">No registrations are waiting for review.</div>
      )}
    </section>
    <section className="product-section">
      <div className="product-heading-row"><h2>Venue maintenance</h2>
        <Link className="text-link" to="/admin/venues?status=MAINTENANCE">View venues <ArrowRight size={16} /></Link>
      </div>
      {maintenance.isPending ? <Skeleton className="skeleton-block" /> : maintenance.isError ? <Alert tone="danger" title="Could not load venues">
        <button className="inline-link" type="button" onClick={() => void maintenance.refetch()}>Try again</button>
      </Alert> : maintenance.data?.venues.length ? <ul className="admin-list">{maintenance.data.venues.map((venue) => (
        <li className="product-panel admin-list-item" key={venue.id}><div><strong>{venue.name}</strong><p>{venue.building}</p></div>
          <span className="availability-label availability-competing"><Wrench size={17} /> Maintenance</span></li>
      ))}</ul> : <div className="product-panel">No venues are in maintenance.</div>}
    </section>
    {Boolean(inbox.data?.total) && <Link className="text-link" to="/approvals">{inbox.data!.total} bookings need review <ArrowRight size={16} /></Link>}
    {reviewing && <UserReviewDialog mode="review" user={reviewing} onClose={() => setReviewing(undefined)} />}
  </div>;
}
