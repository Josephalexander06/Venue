import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, EnvelopeSimple } from '@phosphor-icons/react';
import { api, ApiError, fieldError } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, PasswordField, TextField } from '../components/ui';

export function LoginPage() {
  usePageTitle('Sign in');
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: api.login,
    onSuccess: (session) => {
      setSession(session);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
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

  function clearError() {
    if (login.isError) login.reset();
  }

  return (
    <AuthLayout>
      <div className="auth-card">
        <h1>Sign in</h1>
        <p className="auth-subtitle">
          Use your approved college account to book venues and manage requests.
        </p>

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
      </div>
    </AuthLayout>
  );
}
