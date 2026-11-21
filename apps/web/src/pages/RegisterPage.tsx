import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  EnvelopeSimple,
  Phone,
  User,
} from '@phosphor-icons/react';
import { api, ApiError, fieldError } from '../lib/api';
import { usePageTitle } from '../auth';
import { AuthLayout } from '../components/AuthLayout';
import {
  Alert,
  Button,
  PasswordField,
  SelectField,
  TextField,
} from '../components/ui';

export function RegisterPage() {
  usePageTitle('Request an account');
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState<string>();

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: api.departments,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const registration = useMutation({
    mutationFn: api.register,
    onSuccess: () => {
      navigate(`/register/pending?email=${encodeURIComponent(email.trim().toLowerCase())}`, {
        replace: true,
      });
    },
  });

  const error = registration.error instanceof ApiError ? registration.error : null;
  const emailError =
    fieldError(registration.error, 'email') ??
    (error?.code === 'EMAIL_IN_USE' ? error.message : undefined);
  const generalError =
    error && !error.fieldErrors && error.code !== 'EMAIL_IN_USE' ? error.message : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setConfirmError('Passwords do not match.');
      return;
    }
    setConfirmError(undefined);
    registration.mutate({
      firstName,
      lastName,
      email,
      phone,
      departmentId,
      password,
    });
  }

  function clearServerError() {
    if (registration.isError) registration.reset();
  }

  return (
    <AuthLayout>
      <div className="auth-card auth-card-register">
        <h1>Request an account</h1>
        <p className="auth-subtitle">
          A college administrator will verify your details before activating your account.
        </p>

        {generalError && (
          <div className="auth-alert">
            <Alert tone="danger" title="We could not submit your request">
              {generalError}
            </Alert>
          </div>
        )}

        {departments.isError && (
          <div className="auth-alert">
            <Alert tone="danger" title="Departments unavailable">
              We could not load the department list.{' '}
              <button
                type="button"
                className="inline-link"
                onClick={() => void departments.refetch()}
              >
                Try again
              </button>
            </Alert>
          </div>
        )}

        <form className="form-stack" onSubmit={handleSubmit} aria-busy={registration.isPending}>
          <div className="form-row">
            <TextField
              name="firstName"
              label="First name"
              placeholder="Ananya"
              autoComplete="given-name"
              leadingIcon={<User size={18} />}
              value={firstName}
              onChange={(event) => {
                setFirstName(event.target.value);
                clearServerError();
              }}
              error={fieldError(registration.error, 'firstName')}
              maxLength={100}
              required
            />
            <TextField
              name="lastName"
              label="Last name"
              placeholder="Rao"
              autoComplete="family-name"
              value={lastName}
              onChange={(event) => {
                setLastName(event.target.value);
                clearServerError();
              }}
              error={fieldError(registration.error, 'lastName')}
              maxLength={100}
              required
            />
          </div>

          <TextField
            name="email"
            label="College email"
            type="email"
            placeholder="you@college.edu"
            autoComplete="email"
            inputMode="email"
            leadingIcon={<EnvelopeSimple size={18} />}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearServerError();
            }}
            error={emailError}
            required
          />

          <div className="form-row">
            <SelectField
              name="departmentId"
              label="Department"
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                clearServerError();
              }}
              error={fieldError(registration.error, 'departmentId')}
              disabled={departments.isPending}
              required
            >
              <option value="" disabled>
                {departments.isPending ? 'Loading departments…' : 'Select your department'}
              </option>
              {departments.data?.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name} ({department.code})
                </option>
              ))}
            </SelectField>

            <TextField
              name="phone"
              label="Phone"
              type="tel"
              placeholder="+91 98765 43210"
              autoComplete="tel"
              leadingIcon={<Phone size={18} />}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                clearServerError();
              }}
              error={fieldError(registration.error, 'phone')}
              maxLength={20}
              optional
            />
          </div>

          <div className="form-row">
            <PasswordField
              name="password"
              label="Password"
              placeholder="Create a password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setConfirmError(undefined);
                clearServerError();
              }}
              error={fieldError(registration.error, 'password')}
              hint="At least 12 characters, including a letter and a number."
              minLength={12}
              maxLength={128}
              required
            />
            <PasswordField
              name="confirmPassword"
              label="Confirm password"
              placeholder="Repeat your password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setConfirmError(undefined);
              }}
              error={confirmError}
              minLength={12}
              maxLength={128}
              required
            />
          </div>

          <Button type="submit" size="lg" className="btn-block" loading={registration.isPending}>
            Submit access request
            {!registration.isPending && <ArrowRight size={18} aria-hidden="true" />}
          </Button>
        </form>

        <p className="auth-switch">
          Already approved? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
