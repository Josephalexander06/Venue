import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type RoleName } from '@venue/shared';
import {
  ArrowSquareOut,
  CalendarBlank,
  CalendarCheck,
  House,
  ShieldCheck,
  SignOut,
  Storefront,
  UserCircle,
  UsersThree,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import { Avatar, BrandLockup, Spinner, useToast } from './ui';

const ROLE_PRIORITY: RoleName[] = [
  'ADMINISTRATOR',
  'PRINCIPAL',
  'BURSAR',
  'HOD',
  'FACULTY',
  'STUDENT',
];

function primaryRole(roles: RoleName[]) {
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? roles[0] ?? null;
}

function navClass({ isActive }: { isActive: boolean }) {
  return `nav-link ${isActive ? 'is-active' : ''}`;
}

export function AppShell() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: api.adminStats,
    enabled: isAdmin,
    staleTime: 15_000,
    retry: false,
  });

  if (!user) return null;

  const roleNames = user.roles.map((entry) => entry.role);
  const mainRole = primaryRole(roleNames);
  const pendingCount = stats.data?.counts.PENDING_APPROVAL ?? 0;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch {
      pushToast({
        tone: 'danger',
        title: 'Could not sign out',
        message: 'Check your connection and try again.',
      });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <Link to="/home" className="sidebar-brand" aria-label="Campus Venue home">
            <BrandLockup tone="light" />
          </Link>

          <nav className="sidebar-nav" aria-label="Primary">
            <p className="nav-label">Workspace</p>
            <NavLink to="/home" className={navClass}>
              <House size={19} />
              <span>Home</span>
            </NavLink>
            <NavLink to="/venues" className={navClass}>
              <CalendarBlank size={19} />
              <span>Browse venues</span>
            </NavLink>
            <NavLink to="/my-events" className={navClass}>
              <CalendarCheck size={19} />
              <span>My events</span>
            </NavLink>
            <NavLink to="/account" className={navClass}>
              <UserCircle size={19} />
              <span>My account</span>
            </NavLink>

            {isAdmin && (
              <>
                <p className="nav-label nav-label-spaced">Administration</p>
                <NavLink to="/admin" end className={navClass}>
                  <ShieldCheck size={19} />
                  <span>Admin overview</span>
                </NavLink>
                <NavLink to="/admin/users" className={navClass}>
                  <UsersThree size={19} />
                  <span>User approvals</span>
                  {pendingCount > 0 && (
                    <span className="nav-count" aria-label={`${pendingCount} awaiting review`}>
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </NavLink>
                <NavLink to="/admin/venues" className={navClass}>
                  <Storefront size={19} />
                  <span>Venue catalogue</span>
                </NavLink>
              </>
            )}
          </nav>

          <div className="sidebar-footer">
            <Link to="/account" className="sidebar-user">
              <Avatar firstName={user.firstName} lastName={user.lastName} size="md" />
              <span className="sidebar-user-copy">
                <strong>
                  {user.firstName} {user.lastName}
                </strong>
                <span>{mainRole ? ROLE_LABELS[mainRole] : user.email}</span>
              </span>
              <ArrowSquareOut size={16} aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="sidebar-signout"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? <Spinner size={17} /> : <SignOut size={17} />}
              Sign out
            </button>
          </div>
        </aside>

        <div className="app">
          <header className="mobile-bar">
            <Link to="/home" aria-label="Campus Venue home">
              <BrandLockup compact />
            </Link>
            <Link to="/account" aria-label="Open my account">
              <Avatar firstName={user.firstName} lastName={user.lastName} size="sm" />
            </Link>
          </header>

          <main id="main-content" className="app-main">
            <Outlet />
          </main>
        </div>

        <nav className="mobile-nav" aria-label="Primary mobile">
          <NavLink to="/home" className={navClass}>
            <House size={21} />
            <span>Home</span>
          </NavLink>
          <NavLink to="/venues" className={navClass}>
            <CalendarBlank size={21} />
            <span>Venues</span>
          </NavLink>
          {isAdmin ? (
            <>
              <NavLink to="/admin" end className={navClass}>
                <ShieldCheck size={21} />
                <span>Console</span>
              </NavLink>
              <NavLink to="/admin/users" className={navClass}>
                <UsersThree size={21} />
                <span>Approvals</span>
                {pendingCount > 0 && <span className="mobile-nav-count" aria-hidden="true" />}
              </NavLink>
            </>
          ) : (
            <NavLink to="/my-events" className={navClass}>
              <CalendarCheck size={21} />
              <span>Bookings</span>
            </NavLink>
          )}
          <NavLink to="/account" className={navClass}>
            <UserCircle size={21} />
            <span>Account</span>
          </NavLink>
        </nav>
      </div>
    </>
  );
}
