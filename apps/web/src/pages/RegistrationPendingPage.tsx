import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, ClockCountdown } from '@phosphor-icons/react';
import { useAuth, usePageTitle } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { Button } from '../components/ui';

export function RegistrationPendingPage() {
  usePageTitle('Account under review');
  const { user, logout } = useAuth();
  if (user?.status === 'ACTIVE') return <Navigate to="/home" replace />;
  return <AuthLayout>
    <div className="auth-card pending-card">
      <span className="success-emblem"><ClockCountdown size={30} aria-hidden="true" /></span>
      <h1>{user ? 'Your account is under review' : 'Check your account status'}</h1>
      <p className="auth-subtitle">{user ? 'A campus administrator will review your request. ' : 'Sign in to check your request. '}Contact your college office if you need help with access.</p>
      {user && <p className="email-confirm">{user.email}</p>}
      <div className="pending-actions">
        {user ? <>
          <Link to="/venues" className="btn btn-primary btn-lg">Browse venues <ArrowRight size={18} /></Link>
          <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
        </> : <Link to="/login" className="btn btn-primary btn-lg">Sign in</Link>}
      </div>
    </div>
  </AuthLayout>;
}
