'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type ApiKey, type Me } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Any 401 means the session is gone: send the user to log in.
  const handle = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    },
    [router],
  );

  useEffect(() => {
    Promise.all([api<Me>('/auth/me'), api<{ apiKeys: ApiKey[] }>('/api-keys')])
      .then(([meRes, keysRes]) => {
        setMe(meRes);
        setKeys(keysRes.apiKeys);
      })
      .catch(handle);
  }, [handle]);

  async function createKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    setCreating(true);
    try {
      const name = String(new FormData(form).get('name') ?? '');
      const res = await api<{ key: string; apiKey: ApiKey }>('/api-keys', { method: 'POST', body: JSON.stringify({ name }) });
      setNewKey(res.key);
      setCopied(false);
      setKeys((k) => [res.apiKey, ...k]);
      form.reset();
    } catch (err) {
      handle(err);
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(key: ApiKey) {
    if (!confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return;
    setError(null);
    try {
      await api(`/api-keys/${key.id}`, { method: 'DELETE' });
      setKeys((k) => k.filter((x) => x.id !== key.id));
    } catch (err) {
      handle(err);
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
  }

  if (!me) {
    return <main>{error ? <p className="error">{error}</p> : <p>Loading…</p>}</main>;
  }

  return (
    <main>
      <div className="row">
        <div>
          <h1>{me.workspace.name}</h1>
          <p>Signed in as {me.user.email}</p>
        </div>
        <button className="secondary" onClick={logout}>
          Log out
        </button>
      </div>

      <section className="card">
        <h2>API keys</h2>
        <p>Your chat widget uses an API key to talk to the agent. Keep keys secret.</p>

        {newKey && (
          <div className="key-box" role="status">
            <strong>Copy your new key now. You won&apos;t be able to see it again.</strong>
            <code>{newKey}</code>
            <button onClick={copyKey}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
        )}

        <form onSubmit={createKey} className="inline-form">
          <input name="name" placeholder="Key name, e.g. Website widget" maxLength={50} required />
          <button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}

        {keys.length === 0 ? (
          <p className="muted">No keys yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <code>{k.prefix}…</code>
                  </td>
                  <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="danger" onClick={() => revokeKey(k)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
