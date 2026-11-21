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
        <h1>Your account is in the review queue</h1>
        <p className="auth-subtitle">
          A college administrator will review your request before you can sign in.
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
          <li className="timeline-step is-current" aria-current="step">
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
          Contact your college administrator if you need to correct any details.
        </p>

        <div className="pending-actions">
          <Link to="/login" className="btn btn-secondary btn-lg">
            <ArrowLeft size={17} aria-hidden="true" /> Back to sign in
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
