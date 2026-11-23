import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from '@phosphor-icons/react';
import { api, fieldError } from '../lib/api';
import { useAuth, usePageTitle } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, PasswordField, TextField } from '../components/ui';

export function RegisterPage() {
  usePageTitle('Request an account');
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const registration = useMutation({
    mutationFn: async () => {
      const [firstName = '', ...remaining] = name.trim().split(/\s+/);
      await api.register({ firstName, lastName: remaining.join(' ') || firstName, email, password });
      return api.getMe().catch(() => null);
    },
    onSuccess: (session) => {
      setSession(session);
      void navigate('/register/pending', { replace: true });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    registration.mutate();
  }

  return <AuthLayout>
    <div className="auth-card">
      <h1>Request an account</h1>
      <p className="auth-subtitle">Use your college email to join Campus Venue.</p>
      {registration.error && <Alert tone="danger" title={registration.error.message} />}
      <form className="form-stack" onSubmit={submit}>
        <TextField name="name" label="Full name" autoComplete="name" placeholder="Your full name" required
          value={name} onChange={(event) => setName(event.target.value)}
          error={fieldError(registration.error, 'firstName') ?? fieldError(registration.error, 'lastName')} />
        <TextField name="email" label="College email" type="email" autoComplete="email" placeholder="you@college.edu" required
          value={email} onChange={(event) => setEmail(event.target.value)} error={fieldError(registration.error, 'email')} />
        <PasswordField name="password" label="Password" autoComplete="new-password" required value={password}
          onChange={(event) => setPassword(event.target.value)} error={fieldError(registration.error, 'password')} />
        <Button type="submit" className="btn-block" size="lg" loading={registration.isPending}>Request access <ArrowRight size={18} /></Button>
      </form>
      <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
    </div>
  </AuthLayout>;
}
