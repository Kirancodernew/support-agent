'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ApiError, type FieldError, type Me } from '@/lib/api';

type Mode = 'signup' | 'login';

const copy = {
  signup: { title: 'Create your workspace', button: 'Sign up', switchText: 'Already have an account?', switchHref: '/login', switchLink: 'Log in' },
  login: { title: 'Log in', button: 'Log in', switchText: 'New here?', switchHref: '/signup', switchLink: 'Create an account' },
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const text = copy[mode];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);
    setSubmitting(true);
    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api<Me>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(form) });
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.details);
      } else {
        setError('Could not reach the server. Try again.');
      }
      setSubmitting(false);
    }
  }

  const errorFor = (field: string) => fieldErrors.find((f) => f.path === field)?.message;

  return (
    <main className="narrow">
      <h1>{text.title}</h1>
      <form onSubmit={onSubmit} className="card form" noValidate>
        {mode === 'signup' && (
          <Field label="Company name" name="workspaceName" autoComplete="organization" error={errorFor('workspaceName')} />
        )}
        <Field label="Email" name="email" type="email" autoComplete="email" error={errorFor('email')} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          hint={mode === 'signup' ? 'At least 8 characters' : undefined}
          error={errorFor('password')}
        />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Please wait…' : text.button}
        </button>
      </form>
      <p>
        {text.switchText} <Link href={text.switchHref}>{text.switchLink}</Link>
      </p>
    </main>
  );
}

type FieldProps = { label: string; name: string; type?: string; autoComplete?: string; hint?: string; error?: string };

function Field({ label, name, type = 'text', autoComplete, hint, error }: FieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} type={type} autoComplete={autoComplete} aria-invalid={Boolean(error)} required />
      {error ? <small className="error">{error}</small> : hint && <small>{hint}</small>}
    </label>
  );
}
