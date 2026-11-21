import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type RoleName } from '@venue/shared';
import {
  Buildings,
  CalendarBlank,
  CalendarCheck,
  CaretRight,
  CheckSquareOffset,
  GitBranch,
  House,
  ShieldCheck,
  SignOut,
  Storefront,
  UsersThree,
} from '@phosphor-icons/react';
import { useAuth } from '../auth';
import { api } from '../lib/api';
import { Avatar, BrandLockup } from './ui';

const ROLE_PRIORITY: RoleName[] = [
  'ADMINISTRATOR',
  'PRINCIPAL',
  'BURSAR',
  'HOD',
  'FACULTY',
  'STUDENT',
];

const ADMIN_LINKS = [
  { to: '/admin', label: 'Overview', icon: ShieldCheck },
  { to: '/admin/users', label: 'Users', icon: UsersThree },
  { to: '/admin/venues', label: 'Manage venues', icon: Storefront },
  { to: '/admin/departments', label: 'Departments', icon: Buildings },
  { to: '/admin/workflows', label: 'Approval workflows', icon: GitBranch },
];

function navClass({ isActive }: { isActive: boolean }) {
  return `nav-link${isActive ? ' is-active' : ''}`;
}

export function AppShell() {
  const { user, isAdmin, isApprover, isFacultyOnlyApprover, logout } = useAuth();
  const { pathname } = useLocation();

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: api.adminStats,
    enabled: isAdmin,
    staleTime: 15_000,
  });

  const inbox = useQuery({
    queryKey: ['approvals', 'inbox-preview'],
    queryFn: () => api.approvalInbox({ limit: 3 }),
    enabled: isApprover,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (!user) return null;

  const mainRole = ROLE_PRIORITY.find((role) => user.roles.some((entry) => entry.role === role));
  const pendingCount = stats.data?.counts.PENDING_APPROVAL ?? 0;
  const inboxCount = inbox.data?.total ?? 0;
  const home = isAdmin ? '/admin' : '/home';
  const adminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  const approvalLabel = isFacultyOnlyApprover ? 'Endorsements' : 'Approval inbox';
  const section = adminArea ? ADMIN_LINKS.find(({ to }) => to === pathname)?.label : {
    home: 'Home',
    venues: 'Venues',
    'my-events': 'My events',
    approvals: approvalLabel,
    account: 'My account',
  }[pathname.split('/')[1] ?? ''];

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="app-shell">
        <aside className="sidebar">
          <Link to={home} className="sidebar-brand" aria-label="Campus Venue home">
            <BrandLockup compact />
          </Link>

          <nav className="sidebar-nav" aria-label="Primary">
            <p className="nav-label">Workspace</p>
            {!isAdmin && (
              <NavLink to="/home" className={navClass}>
                <House size={18} aria-hidden="true" /> Home
              </NavLink>
            )}
            <NavLink to="/venues" className={navClass}>
              <CalendarBlank size={18} aria-hidden="true" /> Browse venues
            </NavLink>
            <NavLink to="/my-events" className={navClass}>
              <CalendarCheck size={18} aria-hidden="true" /> My events
            </NavLink>
            {isApprover && (
              <NavLink to="/approvals" className={navClass}>
                <CheckSquareOffset size={18} aria-hidden="true" /> {approvalLabel}
                {inboxCount > 0 && (
                  <span className="nav-count" aria-label={`${inboxCount} awaiting decision`}>
                    {inboxCount > 99 ? '99+' : inboxCount}
                  </span>
                )}
              </NavLink>
            )}

            {isAdmin && (
              <>
                <p className="nav-label nav-label-spaced">Administration</p>
                {ADMIN_LINKS.map(({ to, label, icon: Icon }) => (
                  <NavLink to={to} end key={to} className={navClass}>
                    <Icon size={18} aria-hidden="true" /> {label}
                    {to === '/admin/users' && pendingCount > 0 && (
                      <span className="nav-count" aria-label={`${pendingCount} awaiting review`}>
                        {pendingCount > 99 ? '99+' : pendingCount}
                      </span>
                    )}
                  </NavLink>
                ))}
              </>
            )}
          </nav>

          <div className="sidebar-footer">
            <Link to="/account" className="sidebar-user" aria-label="My account">
              <Avatar firstName={user.firstName} lastName={user.lastName} size="md" />
              <span className="sidebar-user-copy">
                <strong>{user.firstName} {user.lastName}</strong>
                <span>{mainRole ? ROLE_LABELS[mainRole] : user.email}</span>
              </span>
              <CaretRight size={15} aria-hidden="true" />
            </Link>
            <button type="button" className="sidebar-signout" onClick={() => void logout()}>
              <SignOut size={17} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </aside>

        <div className="app">
          <header className="workspace-bar">
            <div className="workspace-location">
              <span>{adminArea ? 'Administration' : 'Workspace'}</span>
              {section && <><CaretRight size={12} aria-hidden="true" /><strong>{section}</strong></>}
            </div>
            {user.department && <span className="workspace-department">{user.department.name}</span>}
          </header>
          <header className="mobile-bar">
            <Link to={home} aria-label="Campus Venue home">
              <BrandLockup compact />
            </Link>
            <Link to="/account" aria-label="My account" className="mobile-account">
              <Avatar firstName={user.firstName} lastName={user.lastName} size="sm" />
            </Link>
          </header>

          {adminArea && isAdmin && (
            <nav className="mobile-admin-nav" aria-label="Administration">
              {ADMIN_LINKS.map(({ to, label }) => (
                <NavLink to={to} end key={to}>{label}</NavLink>
              ))}
            </nav>
          )}

          <main id="main-content" className="app-main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>

        <nav className="mobile-nav" aria-label="Primary mobile">
          <NavLink to={home} end={!isAdmin} className={navClass}>
            {isAdmin ? <ShieldCheck size={21} aria-hidden="true" /> : <House size={21} aria-hidden="true" />}
            <span>{isAdmin ? 'Console' : 'Home'}</span>
            {isAdmin && pendingCount > 0 && <span className="mobile-nav-count" aria-label={`${pendingCount} users awaiting review`} />}
          </NavLink>
          <NavLink to="/venues" className={navClass}>
            <CalendarBlank size={21} aria-hidden="true" />
            <span>Venues</span>
          </NavLink>
          <NavLink to="/my-events" className={navClass}>
            <CalendarCheck size={21} aria-hidden="true" />
            <span>My events</span>
          </NavLink>
          {isApprover && (
            <NavLink to="/approvals" className={navClass}>
              <CheckSquareOffset size={21} aria-hidden="true" />
              <span>{isFacultyOnlyApprover ? 'Endorse' : 'Inbox'}</span>
              {inboxCount > 0 && <span className="mobile-nav-count" aria-label={`${inboxCount} awaiting decision`} />}
            </NavLink>
          )}
        </nav>
      </div>
    </>
  );
}
