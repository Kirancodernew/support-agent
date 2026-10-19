'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, type ApiKey, type ErrorHandler } from '@/lib/api';

export function ApiKeysPanel({ onError }: { onError: ErrorHandler }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<{ apiKeys: ApiKey[] }>('/api-keys')
      .then((res) => setKeys(res.apiKeys))
      .catch(onError);
  }, [onError]);

  async function createKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setCreating(true);
    try {
      const name = String(new FormData(form).get('name') ?? '');
      const res = await api<{ key: string; apiKey: ApiKey }>('/api-keys', { method: 'POST', body: JSON.stringify({ name }) });
      setNewKey(res.key);
      setCopied(false);
      setKeys((k) => [res.apiKey, ...k]);
      form.reset();
    } catch (err) {
      onError(err);
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(key: ApiKey) {
    if (!confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return;
    try {
      await api(`/api-keys/${key.id}`, { method: 'DELETE' });
      setKeys((k) => k.filter((x) => x.id !== key.id));
    } catch (err) {
      onError(err);
    }
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
  }

  return (
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
  );
}
