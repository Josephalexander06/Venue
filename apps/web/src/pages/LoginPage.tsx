import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, EnvelopeSimple, User } from '@phosphor-icons/react';
import { api, ApiError, fieldError } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Dialog, GoogleLogo, PasswordField, TextField } from '../components/ui';

export function LoginPage() {
  usePageTitle('Sign in');
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleName, setGoogleName] = useState('');

  const login = useMutation({
    mutationFn: api.login,
    onSuccess: (session) => {
      setSession(session);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    },
  });

  const googleAuthMutation = useMutation({
    mutationFn: api.googleAuth,
    onSuccess: (result) => {
      if ('user' in result && result.user) {
        setSession(result);
        setShowGoogleModal(false);
        const from = (location.state as { from?: string } | null)?.from;
        navigate(from && from !== '/login' ? from : '/', { replace: true });
      } else {
        setShowGoogleModal(false);
        const targetEmail = 'email' in result ? result.email : googleEmail;
        navigate(`/register/pending?email=${encodeURIComponent(targetEmail)}`, {
          replace: true,
        });
      }
    },
  });

  const error = login.error instanceof ApiError ? login.error : null;
  const generalError =
    error && (error.code !== 'VALIDATION_ERROR' || !error.fieldErrors)
      ? error.message
      : login.isError && !error ? 'Could not connect. Try signing in again.' : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  function handleGoogleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parts = googleName.trim().split(' ');
    const firstName = parts[0] || undefined;
    const lastName = parts.slice(1).join(' ') || undefined;
    googleAuthMutation.mutate({
      email: googleEmail.trim().toLowerCase(),
      firstName,
      lastName,
    });
  }

  function clearError() {
    if (login.isError) login.reset();
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <h1>Sign in</h1>
        <p className="auth-subtitle">
          Sign in to book venues or manage your event schedule.
        </p>

        {/* Primary Google Auth Option (Consumer Booking Style) */}
        <button
          type="button"
          className="btn-google"
          onClick={() => {
            setGoogleEmail(email || 'user@college.edu');
            setShowGoogleModal(true);
          }}
        >
          <GoogleLogo size={20} />
          <span>Continue with Google</span>
        </button>

        <div className="auth-divider">
          <span>or sign in with password</span>
        </div>

        {generalError && (
          <div className="auth-alert">
            <Alert tone={error?.code.startsWith('ACCOUNT_') ? 'warning' : 'danger'} title="Sign-in failed">
              {generalError}
            </Alert>
          </div>
        )}

        <form className="form-stack" onSubmit={handleSubmit} aria-busy={login.isPending}>
          <TextField
            name="email"
            label="College email"
            type="email"
            placeholder="you@college.edu"
            autoComplete="username"
            inputMode="email"
            leadingIcon={<EnvelopeSimple size={18} />}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearError();
            }}
            error={fieldError(login.error, 'email')}
            required
          />

          <PasswordField
            name="password"
            label="Password"
            placeholder="Enter your password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              clearError();
            }}
            error={fieldError(login.error, 'password')}
            required
          />

          <Button type="submit" size="lg" className="btn-block" loading={login.isPending}>
            Sign in
            {!login.isPending && <ArrowRight size={18} aria-hidden="true" />}
          </Button>
        </form>

        <p className="auth-switch">
          New to Campus Venue? <Link to="/register">Request an account</Link>
        </p>

        {/* Google Authentication Dialog */}
        <Dialog
          open={showGoogleModal}
          onClose={() => setShowGoogleModal(false)}
          title="Sign in with Google"
        >
          <div className="google-auth-modal-content">
            <div className="google-auth-badge">
              <GoogleLogo size={28} />
              <div>
                <strong>Campus Venue Google Single Sign-On</strong>
                <p>Use your college Google Workspace account</p>
              </div>
            </div>

            {googleAuthMutation.isError && (
              <div style={{ marginTop: '12px' }}>
                <Alert tone="danger" title="Authentication failed">
                  {googleAuthMutation.error instanceof ApiError
                    ? googleAuthMutation.error.message
                    : 'Could not connect with Google.'}
                </Alert>
              </div>
            )}

            <form onSubmit={handleGoogleSubmit} className="form-stack" style={{ marginTop: '16px' }}>
              <TextField
                name="googleEmail"
                label="Google email address"
                type="email"
                placeholder="your.name@college.edu"
                value={googleEmail}
                onChange={(e) => setGoogleEmail(e.target.value)}
                leadingIcon={<EnvelopeSimple size={18} />}
                required
              />
              <TextField
                name="googleName"
                label="Full name (for new accounts)"
                placeholder="Ananya Rao"
                value={googleName}
                onChange={(e) => setGoogleName(e.target.value)}
                leadingIcon={<User size={18} />}
              />
              <p className="field-hint" style={{ fontSize: '12px', color: 'var(--ink-3)' }}>
                New accounts will be submitted for college administrator verification.
              </p>
              <div className="modal-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowGoogleModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={googleAuthMutation.isPending}
                >
                  Continue with Google
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      </div>
    </AuthLayout>
  );
}
