import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, ClockCountdown, EnvelopeSimple, SealCheck } from '@phosphor-icons/react';
import { usePageTitle } from '../auth';
import { AuthLayout } from '../components/AuthLayout';

export function RegistrationPendingPage() {
  usePageTitle('Request received');
  const [params] = useSearchParams();
  const email = params.get('email');

  return (
    <AuthLayout>
      <div className="auth-card pending-card">
        <span className="success-emblem" aria-hidden="true">
          <SealCheck size={34} weight="duotone" />
        </span>
        <p className="eyebrow">Request received</p>
        <h1>Your account is in the review queue</h1>
        <p className="auth-subtitle">
          Thank you for registering. An administrator will verify your details and assign the
          right level of access.
        </p>

        {email && (
          <div className="email-confirm">
            <EnvelopeSimple size={18} aria-hidden="true" />
            <span>
              Submitted for <strong>{email}</strong>
            </span>
          </div>
        )}

        <ol className="timeline">
          <li className="timeline-step is-complete">
            <span className="timeline-marker">
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
            </span>
            <span className="timeline-copy">
              <strong>Registration received</strong>
              <span>Your account details are securely saved.</span>
            </span>
          </li>
          <li className="timeline-step is-current">
            <span className="timeline-marker">
              <ClockCountdown size={18} weight="fill" aria-hidden="true" />
            </span>
            <span className="timeline-copy">
              <strong>Administrator review</strong>
              <span>Your identity and department will be verified.</span>
            </span>
          </li>
          <li className="timeline-step">
            <span className="timeline-marker">
              <SealCheck size={18} aria-hidden="true" />
            </span>
            <span className="timeline-copy">
              <strong>Access activated</strong>
              <span>Sign in with this email once your account is approved.</span>
            </span>
          </li>
        </ol>

        <p className="pending-note">
          If your details need correction, contact the college administrator. You do not need
          to register again.
        </p>

        <div className="pending-actions">
          <Link to="/login" className="btn btn-secondary btn-lg">
            <ArrowLeft size={17} aria-hidden="true" /> Back to sign in
          </Link>
          <Link to="/register" className="text-link">
            Register another account
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
