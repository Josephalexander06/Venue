import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, Buildings, CalendarCheck, GearSix, House, MapTrifold, Tray } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { api } from '../lib/api';
import { Avatar, BrandLockup } from './ui';

export const APPROVAL_PREVIEW_KEY = ['approvals', 'inbox-preview'] as const;

function navClass({ isActive }: { isActive: boolean }) {
  return `product-nav-link${isActive ? ' is-active' : ''}`;
}

export function AppShell() {
  const { user, isAdmin, isApprover, isFacultyOnlyApprover, canBook, approvalOnly, isDepartmentHead } = useAuth();
  const { pathname } = useLocation();
  const inbox = useQuery({
    queryKey: APPROVAL_PREVIEW_KEY,
    queryFn: () => api.approvalInbox({ limit: 3 }),
    enabled: isApprover && !approvalOnly,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (!user) return null;

  const pending = user.status === 'PENDING_APPROVAL';
  const count = inbox.data?.total ?? 0;
  const browse = { to: '/venues', label: 'Explore venues', short: 'Book', icon: MapTrifold };
  const available: { to: string; label: string; short: string; icon: typeof Bell; count?: number }[] = pending ? [browse] : [
    approvalOnly
      ? { to: '/approvals', label: 'Approvals', short: 'Approvals', icon: Bell }
      : { to: '/home', label: 'Home', short: 'Home', icon: House },
    ...(canBook ? [browse, { to: '/bookings', label: 'My bookings', short: 'Mine', icon: CalendarCheck }] : []),
    ...(isFacultyOnlyApprover ? [{ to: '/approvals', label: 'Incoming requests', short: 'Requests', icon: Tray, count }] : []),
    ...(isDepartmentHead ? [{ to: '/department', label: 'Department', short: 'Department', icon: Buildings }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', short: 'Admin', icon: GearSix }] : []),
  ];

  function requestLabel(total: number | undefined) {
    return total ? `Incoming requests, ${total} pending` : undefined;
  }

  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <div className="product-shell">
      <header className="product-header">
        <div className="product-header-inner">
          <Link to={pending ? '/venues' : approvalOnly ? '/approvals' : '/home'} className="product-brand" aria-label="Campus Venue home"><BrandLockup compact /></Link>
          <nav className="product-top-nav" aria-label="Primary">
            {available.map(({ to, label, count }) => <NavLink className={navClass} key={to} to={to} aria-label={requestLabel(count)}>
              {label}{count !== undefined && count > 0 && <span className="product-count product-nav-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
            </NavLink>)}
          </nav>
          <div className="product-header-actions">
            {isApprover && !approvalOnly && !isFacultyOnlyApprover && <Link className="product-icon-link" to="/approvals"
              aria-label={count ? `Approvals, ${count} need attention` : 'Approvals'}>
              <Bell size={22} aria-hidden="true" />{count > 0 && <i className="notification-dot" aria-hidden="true" />}
            </Link>}
            {pending ? <Link className="product-account" to="/register/pending">Account under review</Link> :
              <Link className="product-account" to="/account" aria-label="My account">
                <Avatar firstName={user.firstName} lastName={user.lastName} size="sm" />
                <span>{user.firstName}</span>
              </Link>}
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="product-main">
        <div className="product-route" key={pathname}><Outlet /></div>
      </main>
      {!pending && <nav className="product-bottom-nav" aria-label="Primary mobile">
        {available.map(({ to, short, icon: Icon, count }) => <NavLink className={navClass} key={to} to={to} aria-label={requestLabel(count)}>
          <span className="product-nav-icon">
            <Icon size={22} aria-hidden="true" weight={pathname.startsWith(to) ? 'fill' : 'regular'} />
            {count !== undefined && count > 0 && <span className="product-count product-nav-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
          </span>
          <span>{short}</span>
        </NavLink>)}
      </nav>}
    </div>
  </>;
}
