'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ErrorHandler } from '@/lib/api';

type InboxItem = {
  id: string;
  number: string;
  kind: 'ticket' | 'callback' | 'handoff';
  summary: string;
  details: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  preferredTime: string | null;
  status: 'open' | 'closed';
  createdAt: string;
  transcript?: { role: string; content: string }[];
};

const KIND_LABEL = { ticket: 'Ticket', callback: 'Call-back', handoff: 'Handoff' };

/** Work the agent handed to the team, with the conversation that led to it. */
export function InboxPanel({ onError }: { onError: ErrorHandler }) {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [items, setItems] = useState<InboxItem[] | null>(null);

  const load = useCallback(
    () =>
      api<{ items: InboxItem[] }>(`/inbox?status=${status}`)
        .then((r) => setItems(r.items))
        .catch(onError),
    [status, onError],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function setItemStatus(item: InboxItem, next: 'open' | 'closed') {
    try {
      await api(`/inbox/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      setItems((all) => all?.filter((i) => i.id !== item.id) ?? null);
    } catch (err) {
      onError(err);
    }
  }

  return (
    <section className="card">
      <div className="row">
        <div>
          <h2>Inbox</h2>
          <p>Tickets, call-back requests and handoffs the agent created for your team.</p>
        </div>
        <div className="actions tabs">
          {(['open', 'closed'] as const).map((s) => (
            <button key={s} className={s === status ? '' : 'secondary'} onClick={() => setStatus(s)}>
              {s === 'open' ? 'Open' : 'Closed'}
            </button>
          ))}
          <button className="secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {items?.length === 0 && <p className="muted">Nothing {status}.</p>}
      <ul className="inbox">
        {items?.map((item) => (
          <li key={item.id} className="inbox-item">
            <div className="row">
              <div>
                <strong>
                  {item.number} · <span className={`kind kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
                </strong>
                <p className="summary">{item.summary}</p>
                <small className="muted">
                  {[item.customerEmail, item.customerPhone, item.preferredTime && `prefers ${item.preferredTime}`]
                    .filter(Boolean)
                    .join(' · ')}
                  {' · '}
                  {new Date(item.createdAt).toLocaleString()}
                </small>
              </div>
              <button className="secondary" onClick={() => setItemStatus(item, status === 'open' ? 'closed' : 'open')}>
                {status === 'open' ? 'Close' : 'Reopen'}
              </button>
            </div>
            {item.details && <p className="details">{item.details}</p>}
            {item.transcript && item.transcript.length > 0 && (
              <details>
                <summary>Conversation</summary>
                <div className="transcript">
                  {item.transcript.map((m, i) => (
                    <p key={i}>
                      <strong>{m.role === 'user' ? 'Customer' : 'Agent'}:</strong> {m.content}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
