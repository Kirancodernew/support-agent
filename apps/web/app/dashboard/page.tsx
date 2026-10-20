'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiKeysPanel } from '@/components/api-keys-panel';
import { AppNav } from '@/components/app-nav';
import { ChatPanel } from '@/components/chat-panel';
import { DeleteWorkspacePanel } from '@/components/delete-workspace-panel';
import { DocumentsPanel } from '@/components/documents-panel';
import { InboxPanel } from '@/components/inbox-panel';
import { IntegrationsPanel } from '@/components/integrations-panel';
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
      <AppNav />
      <div className="row">
        <div>
          <h1>{me.workspace.name}</h1>
          <p>Signed in as {me.user.email}</p>
        </div>
        <button className="secondary" onClick={logout}>
          Log out
        </button>
      </div>

      {me.workspace.isDemo && (
        <p className="demo-banner" role="status">
          You&apos;re exploring a demo shop. Chat with the agent (5 messages an hour), browse Insights and the Inbox.
          Uploads and settings are read-only, and everything resets nightly.{' '}
          <a href="/signup">Sign up free</a> to use your own documents.
        </p>
      )}

      {error && (
        <p className="error banner" role="alert">
          {error}{' '}
          <button className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}

      <InboxPanel onError={onError} />
      <ChatPanel onError={onError} />
      <DocumentsPanel onError={onError} />
      <SearchPanel onError={onError} />
      <WidgetPanel onError={onError} />
      <IntegrationsPanel onError={onError} />
      <ApiKeysPanel onError={onError} />
      {!me.workspace.isDemo && <DeleteWorkspacePanel workspaceName={me.workspace.name} onError={onError} />}
    </main>
  );
}
