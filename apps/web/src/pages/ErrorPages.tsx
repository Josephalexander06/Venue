import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Compass, ShieldWarning } from '@phosphor-icons/react';
import { useAuth, usePageTitle } from '../auth';
import { BrandLockup } from '../components/ui';

function StatePage({
  code,
  title,
  description,
  icon,
}: {
  code: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  const { user } = useAuth();
  return (
    <div className="state-shell">
      <header className="state-header">
        <Link to="/" aria-label="Campus Venue home">
          <BrandLockup />
        </Link>
        <Link to={user ? '/account' : '/login'} className="text-link">
          {user ? 'My account' : 'Sign in'}
        </Link>
      </header>
      <main className="state-card">
        <span className="state-icon">{icon}</span>
        <p className="state-code">{code}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <Link to="/" className="btn btn-primary btn-md">
          <ArrowLeft size={16} /> Back to {user ? 'workspace' : 'sign in'}
        </Link>
      </main>
      <p className="state-foot">Campus Venue · Institutional access</p>
    </div>
  );
}

export function ForbiddenPage() {
  usePageTitle('Access denied');
  return (
    <StatePage
      code="403"
      title="This area is not available to your account"
      description="Your current roles do not include administrator access. If your responsibilities have changed, ask a college administrator to update your account."
      icon={<ShieldWarning size={36} weight="duotone" />}
    />
  );
}

export function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <StatePage
      code="404"
      title="We could not find that page"
      description="The address may be out of date, or the page may have moved. Return to your workspace to continue."
      icon={<Compass size={36} weight="duotone" />}
    />
  );
}
