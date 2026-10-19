'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiKeysPanel } from '@/components/api-keys-panel';
import { ChatPanel } from '@/components/chat-panel';
import { DocumentsPanel } from '@/components/documents-panel';
import { SearchPanel } from '@/components/search-panel';
import { WidgetPanel } from '@/components/widget-panel';
import { api, ApiError, type Me } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared by every panel: a 401 means the session is gone, anything else is shown at the top.
  const onError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    },
    [router],
  );

  useEffect(() => {
    api<Me>('/auth/me').then(setMe).catch(onError);
  }, [onError]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
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

      {error && (
        <p className="error banner" role="alert">
          {error}{' '}
          <button className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}

      <ChatPanel onError={onError} />
      <DocumentsPanel onError={onError} />
      <SearchPanel onError={onError} />
      <WidgetPanel onError={onError} />
      <ApiKeysPanel onError={onError} />
    </main>
  );
}
