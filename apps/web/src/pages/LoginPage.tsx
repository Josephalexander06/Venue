import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, EnvelopeSimple } from '@phosphor-icons/react';
import { api, fieldError } from '../lib/api';
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
    mutationFn: () => api.login({ email, password, browseWhilePending: true }),
    onSuccess: (session) => {
      setSession(session);
      const from = (location.state as { from?: string } | null)?.from;
      void navigate(session.user.status === 'PENDING_APPROVAL' ? '/register/pending' : from ?? '/', { replace: true });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate();
  }

  return <AuthLayout>
    <div className="auth-card">
      <h1>Sign in</h1>
      <p className="auth-subtitle">Book and manage spaces on campus.</p>
      {login.error && <Alert tone="danger" title={login.error.message} />}
      <form className="form-stack" onSubmit={submit}>
        <TextField name="email" label="College email" type="email" placeholder="you@college.edu"
          autoComplete="username" leadingIcon={<EnvelopeSimple size={18} />} required value={email}
          onChange={(event) => { setEmail(event.target.value); login.reset(); }} error={fieldError(login.error, 'email')} />
        <PasswordField name="password" label="Password" placeholder="Enter your password" required
          autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); login.reset(); }}
          error={fieldError(login.error, 'password')} />
        <Button type="submit" size="lg" className="btn-block" loading={login.isPending}>Sign in <ArrowRight size={18} /></Button>
      </form>
      <p className="auth-switch">New to Campus Venue? <Link to="/register">Request an account</Link></p>
    </div>
  </AuthLayout>;
}
