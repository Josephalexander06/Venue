import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS } from '@venue/shared';
import {
  ArrowRight,
  CalendarBlank,
  CheckCircle,
  ClockCountdown,
  EnvelopeSimple,
  IdentificationBadge,
  ShieldCheck,
  UsersThree,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { greeting, plural, todayLabel } from '../lib/format';
import { Avatar, ROLE_DESCRIPTIONS, Skeleton, StatusBadge } from '../components/ui';

export function HomePage() {
  usePageTitle('Home');
  const { user, isAdmin } = useAuth();

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: api.adminStats,
    enabled: isAdmin,
    staleTime: 15_000,
    retry: false,
  });

  if (!user) return null;
  const pending = stats.data?.counts.PENDING_APPROVAL;
  const active = stats.data?.counts.ACTIVE;

  return (
    <>
      <section className="welcome-band">
        <div className="welcome-copy">
          <p className="eyebrow">{todayLabel()}</p>
          <h1>
            {greeting()}, {user.firstName}.
          </h1>
          <p>
            Your account is active. Everything you can access from this workspace is tied to
            your role and department.
          </p>
          <div className="welcome-actions">
            {isAdmin ? (
              <Link to="/admin/users" className="btn btn-accent btn-md">
                Review access requests
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            ) : (
              <Link to="/venues" className="btn btn-accent btn-md">
                Browse campus venues
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            )}
            <Link to={isAdmin ? '/admin' : '/my-events'} className="btn btn-quiet btn-md">
              {isAdmin ? 'Admin overview' : 'My events'}
            </Link>
          </div>
        </div>
        <div className="welcome-emblem" aria-hidden="true">
          <span className="welcome-ring welcome-ring-outer" />
          <span className="welcome-ring welcome-ring-inner" />
          <span className="welcome-seal">
            <ShieldCheck size={42} weight="duotone" />
            <span>Verified</span>
          </span>
          <span className="welcome-emblem-name">{user.department.code}</span>
        </div>
      </section>

      <div className="home-grid">
        <div className="home-main">
          <section className="card" aria-labelledby="access-heading">
            <div className="card-head">
              <div>
                <h2 id="access-heading">Your access</h2>
                <p>Roles assigned to your account and the scope they carry.</p>
              </div>
              <span className="card-icon">
                <IdentificationBadge size={20} />
              </span>
            </div>
            <ul className="access-list">
              {user.roles.map((entry) => (
                <li key={`${entry.role}-${entry.departmentId ?? 'college'}`} className="access-row">
                  <span className={`access-check role-${entry.role.toLowerCase()}`}>
                    <CheckCircle size={17} weight="fill" />
                  </span>
                  <span className="access-copy">
                    <span className="access-title">{ROLE_LABELS[entry.role]}</span>
                    <span className="access-description">{ROLE_DESCRIPTIONS[entry.role]}</span>
                  </span>
                  <span className="access-scope">
                    {entry.departmentId ? user.department.code : 'College-wide'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="card-footnote">
              Need a different role? Ask an administrator to update your access.
            </p>
          </section>

          {isAdmin && (
            <section className="card" aria-labelledby="admin-heading">
              <div className="card-head">
                <div>
                  <h2 id="admin-heading">Administrator workspace</h2>
                  <p>Review new accounts and keep departmental access accurate.</p>
                </div>
                <span className="card-icon card-icon-accent">
                  <UsersThree size={20} />
                </span>
              </div>
              <div className="admin-glance">
                <div className="glance-item">
                  <span className="glance-icon glance-pending">
                    <ClockCountdown size={20} />
                  </span>
                  <span>
                    <strong>
                      {pending === undefined ? <Skeleton className="skeleton-number" /> : pending}
                    </strong>
                    <span>
                      {pending === undefined
                        ? 'Checking the queue'
                        : `${plural(pending, 'account')} awaiting review`}
                    </span>
                  </span>
                </div>
                <div className="glance-item">
                  <span className="glance-icon glance-active">
                    <CheckCircle size={20} />
                  </span>
                  <span>
                    <strong>
                      {active === undefined ? <Skeleton className="skeleton-number" /> : active}
                    </strong>
                    <span>
                      {active === undefined
                        ? 'Checking accounts'
                        : plural(active, 'active account')}
                    </span>
                  </span>
                </div>
              </div>
              <div className="inline-actions">
                <Link to="/admin/users" className="btn btn-secondary btn-sm">
                  Open approval queue <ArrowRight size={15} />
                </Link>
                <Link to="/admin/venues" className="btn btn-ghost btn-sm">
                  Manage venues
                </Link>
              </div>
            </section>
          )}

          {!isAdmin && (
            <section className="card" aria-labelledby="venues-heading">
              <div className="card-head">
                <div>
                  <h2 id="venues-heading">Campus venue services</h2>
                  <p>Find a space, check live availability and submit a booking request.</p>
                </div>
                <span className="card-icon">
                  <CalendarBlank size={20} />
                </span>
              </div>
              <div className="module-preview">
                <span className="module-preview-icon">
                  <CalendarBlank size={26} weight="duotone" />
                </span>
                <div>
                  <strong>Your next event starts here</strong>
                  <p>
                    Browse every active venue, view confirmed and pending bookings on its
                    calendar, and apply for the slot you need in one flow.
                  </p>
                  <div className="inline-actions">
                    <Link to="/venues" className="btn btn-primary btn-sm">
                      Find a venue <ArrowRight size={15} />
                    </Link>
                    <Link to="/my-events" className="btn btn-ghost btn-sm">
                      Track my requests
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="home-side">
          <section className="card" aria-labelledby="account-heading">
            <div className="card-head">
              <div>
                <h2 id="account-heading">Account</h2>
              </div>
              <span className="card-icon">
                <EnvelopeSimple size={20} />
              </span>
            </div>
            <div className="account-summary">
              <Avatar
                firstName={user.firstName}
                lastName={user.lastName}
                size="lg"
              />
              <div>
                <strong>
                  {user.firstName} {user.lastName}
                </strong>
                <span>{user.email}</span>
              </div>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={user.status} />
                </dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{user.department.name}</dd>
              </div>
              <div>
                <dt>Access scope</dt>
                <dd>
                  {user.roles.some((entry) => entry.departmentId)
                    ? user.department.name
                    : 'College-wide'}
                </dd>
              </div>
            </dl>
            <Link to="/account" className="text-link">
              View full account <ArrowRight size={14} />
            </Link>
          </section>

          <section className="side-note">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>Access is auditable</strong>
              <p>
                Role changes and account decisions are recorded against the administrator who
                made them.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
