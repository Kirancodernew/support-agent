'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ApiError, type ErrorHandler } from '@/lib/api';

/** Deletes the workspace and everything in it, after the owner types its name and their password. */
export function DeleteWorkspacePanel({ workspaceName, onError }: { workspaceName: string; onError: ErrorHandler }) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function remove(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password') ?? '');
    setError(null);
    setDeleting(true);
    try {
      await api('/workspace/delete', { method: 'POST', body: JSON.stringify({ confirmName, password }) });
      router.replace('/login?deleted=1');
    } catch (err) {
      // Wrong password or name: say so next to the form, not in the page banner.
      if (err instanceof ApiError && (err.status === 403 || err.status === 400)) setError(err.message);
      else onError(err);
      setDeleting(false);
    }
  }

  return (
    <section className="card danger-zone">
      <h2>Delete workspace</h2>
      <p>
        Permanently deletes <strong>{workspaceName}</strong>: documents and their files, conversations, Inbox,
        API keys and your account. The widget stops working on your sites immediately. This can&apos;t be undone.
      </p>
      <form onSubmit={remove} className="form">
        <label className="field">
          Type <strong>{workspaceName}</strong> to confirm
          <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" required />
        </label>
        <label className="field">
          Your password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <div>
          <button type="submit" className="danger" disabled={deleting || confirmName.trim() !== workspaceName}>
            {deleting ? 'Deleting…' : 'Delete workspace'}
          </button>
        </div>
      </form>
    </section>
  );
}
