import { ROLE_LABELS } from '@venue/shared';
import { SignOut } from '@phosphor-icons/react';
import { useAuth, usePageTitle } from '../auth';
import { Avatar, Button, PageHeader, ROLE_DESCRIPTIONS, StatusBadge } from '../components/ui';

export function AccountPage() {
  usePageTitle('My account');
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="My account"
        actions={
          <Button variant="secondary" onClick={() => void logout()}>
            <SignOut size={17} aria-hidden="true" /> Sign out
          </Button>
        }
      />

      <div className="profile-layout">
        <section className="card" aria-labelledby="profile-name">
          <div className="profile-person">
            <Avatar firstName={user.firstName} lastName={user.lastName} size="lg" />
            <h2 id="profile-name">{user.firstName} {user.lastName}</h2>
          </div>
          <dl className="profile-details">
            <div><dt>College email</dt><dd>{user.email}</dd></div>
            <div><dt>Department</dt><dd>{user.department.name}</dd></div>
            <div><dt>Account status</dt><dd><StatusBadge status={user.status} /></dd></div>
          </dl>
        </section>

        <section className="card" aria-labelledby="roles-heading">
          <div className="card-head">
            <div>
              <h2 id="roles-heading">Roles & access</h2>
              <p>Contact your college administrator to request a change.</p>
            </div>
          </div>
          <ul className="access-list">
            {user.roles.map((entry) => (
              <li key={`${entry.role}-${entry.departmentId ?? 'college'}`} className="access-row">
                <span className="access-copy">
                  <span className="access-title">{ROLE_LABELS[entry.role]}</span>
                  <span className="access-description">{ROLE_DESCRIPTIONS[entry.role]}</span>
                </span>
                <span className="profile-scope">
                  {entry.departmentId ? user.department.name : 'College-wide'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
