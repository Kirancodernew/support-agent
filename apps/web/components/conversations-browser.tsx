'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ErrorHandler } from '@/lib/api';

type Row = { id: string; title: string; channel: string; visitor: string | null; questions: number; needsHuman: boolean; disliked: boolean; updatedAt: string };
type Detail = { messages: { id: string; role: string; content: string; sources: string[]; actions: { tool: string; ok: boolean }[]; feedback: string | null }[] };
type Filter = 'all' | 'needs_human' | 'disliked';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs_human', label: 'Needs a human' },
  { value: 'disliked', label: '👎 Disliked' },
];

/** Every conversation, newest first, 20 at a time; open one to read the transcript. */
export function ConversationsBrowser({ onError, openId }: { onError: ErrorHandler; openId?: string | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<{ id: string; detail: Detail | null } | null>(null);

  const load = useCallback(
    async (next?: string | null) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ filter, ...(next ? { cursor: next } : {}) });
        const page = await api<{ items: Row[]; nextCursor: string | null }>(`/conversations?${qs}`);
        setRows((r) => (next ? [...r, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        onError(err);
      } finally {
        setLoading(false);
      }
    },
    [filter, onError],
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Opens a transcript. Stable (no dependency on what's open), so the effect below runs only when
  // a different conversation is requested from outside (e.g. clicking an unanswered question).
  const openConversation = useCallback(
    async (id: string) => {
      setOpen({ id, detail: null });
      try {
        setOpen({ id, detail: await api<Detail>(`/conversations/${id}`) });
      } catch (err) {
        onError(err);
      }
    },
    [onError],
  );
  const toggle = (id: string) => (open?.id === id ? setOpen(null) : void openConversation(id));
  useEffect(() => {
    if (openId) void openConversation(openId);
  }, [openId, openConversation]);

  return (
    <section className="card">
      <div className="row">
        <h2>Conversations</h2>
        <div className="actions tabs">
          {FILTERS.map((f) => (
            <button key={f.value} className={f.value === filter ? '' : 'secondary'} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {!loading && rows.length === 0 && <p className="muted">No conversations here yet.</p>}
      <ul className="convos">
        {rows.map((c) => (
          <li key={c.id}>
            <button className="convo-row" onClick={() => toggle(c.id)} aria-expanded={open?.id === c.id}>
              <span className="convo-title">{c.title}</span>
              <span className="muted">
                {c.channel === 'widget' ? `Website · visitor ${c.visitor}` : 'Dashboard'} · {c.questions} question{c.questions === 1 ? '' : 's'}
                {c.needsHuman && ' · needs a human'}
                {c.disliked && ' · 👎'} · {new Date(c.updatedAt).toLocaleString('en-IN')}
              </span>
            </button>
            {open?.id === c.id && (
              <div className="transcript">
                {!open.detail && <p className="muted">Loading…</p>}
                {open.detail?.messages.map((m) => (
                  <p key={m.id}>
                    <strong>{m.role === 'user' ? 'Customer' : 'Agent'}:</strong> {m.content}
                    {m.sources.length > 0 && <small className="muted"> · sources: {m.sources.join(', ')}</small>}
                    {m.actions.length > 0 && <small className="muted"> · tools: {m.actions.map((a) => a.tool).join(', ')}</small>}
                    {m.feedback && <small> · {m.feedback === 'up' ? '👍' : '👎'}</small>}
                  </p>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <button className="secondary" disabled={loading} onClick={() => load(cursor)}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
