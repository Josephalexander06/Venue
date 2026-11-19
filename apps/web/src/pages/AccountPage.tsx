import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '@venue/shared';
import {
  ArrowRight,
  Buildings,
  EnvelopeSimple,
  IdentificationBadge,
  LockKey,
  ShieldCheck,
  SignOut,
} from '@phosphor-icons/react';
import { useAuth, usePageTitle } from '../auth';
import {
  Avatar,
  Button,
  PageHeader,
  ROLE_DESCRIPTIONS,
  StatusBadge,
  useToast,
} from '../components/ui';

export function AccountPage() {
  usePageTitle('My account');
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  const roleCount = user.roles.length;
  const isCollegeWide = user.roles.some((entry) => !entry.departmentId);

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
      <PageHeader
        eyebrow="Profile & access"
        title="My account"
        description="Your identity, department and the permissions attached to this account."
        actions={
          isAdmin ? (
            <Link to="/admin" className="btn btn-secondary btn-md">
              Open admin console <ArrowRight size={16} />
            </Link>
          ) : undefined
        }
      />

      <div className="account-grid">
        <section className="card account-identity" aria-label="Account identity">
          <div className="identity-band">
            <Avatar firstName={user.firstName} lastName={user.lastName} size="xl" />
            <div className="identity-copy">
              <h2>
                {user.firstName} {user.lastName}
              </h2>
              <p>{user.email}</p>
              <StatusBadge status={user.status} />
            </div>
            <span className="department-stamp">
              <span>{user.department.code}</span>
              {user.department.name}
            </span>
          </div>

          <dl className="profile-facts">
            <div className="profile-fact">
              <span className="fact-icon">
                <Buildings size={19} />
              </span>
              <div>
                <dt>Department</dt>
                <dd>{user.department.name}</dd>
              </div>
            </div>
            <div className="profile-fact">
              <span className="fact-icon">
                <EnvelopeSimple size={19} />
              </span>
              <div>
                <dt>College email</dt>
                <dd>{user.email}</dd>
              </div>
            </div>
            <div className="profile-fact">
              <span className="fact-icon">
                <IdentificationBadge size={19} />
              </span>
              <div>
                <dt>Access scope</dt>
                <dd>{isCollegeWide ? 'Department & college-wide roles' : user.department.name}</dd>
              </div>
            </div>
          </dl>
        </section>

        <aside className="account-aside">
          <section className="side-note side-note-navy">
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <strong>Secure session</strong>
              <p>
                You are signed in with a protected, server-verified session. Sign out when using
                a shared computer.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSignOut}
              loading={signingOut}
              className="side-note-action"
            >
              {!signingOut && <SignOut size={15} />} Sign out
            </Button>
          </section>

          <section className="card compact-card">
            <div className="card-head">
              <div>
                <h2>Need a change?</h2>
                <p>Names and access levels are managed by college administrators.</p>
              </div>
              <span className="card-icon">
                <LockKey size={19} />
              </span>
            </div>
            <p className="muted-copy">
              Ask an administrator to update your roles if your responsibilities change. Every
              role change is recorded for audit.
            </p>
          </section>
        </aside>
      </div>

      <section className="card account-access" aria-labelledby="roles-heading">
        <div className="card-head">
          <div>
            <h2 id="roles-heading">Access & permissions</h2>
            <p>
              {roleCount > 1
                ? `${roleCount} roles are attached to this account.`
                : 'One role is attached to this account.'}
            </p>
          </div>
          <span className="card-icon card-icon-accent">
            <ShieldCheck size={20} />
          </span>
        </div>

        <ul className="access-list">
          {user.roles.map((entry) => (
            <li key={`${entry.role}-${entry.departmentId ?? 'college'}`} className="access-row">
              <span className={`access-check role-${entry.role.toLowerCase()}`}>
                <ShieldCheck size={17} weight="fill" />
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
      </section>
    </>
  );
}
