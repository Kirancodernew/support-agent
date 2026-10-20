'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '@/components/app-nav';
import { ConversationsBrowser } from '@/components/conversations-browser';
import { DailyChart } from '@/components/daily-chart';
import { api, ApiError } from '@/lib/api';

type Summary = {
  days: number;
  conversations: number;
  questions: number;
  change: { conversations: number | null; questions: number | null };
  answers: number;
  answeredFromDocsPct: number | null;
  unansweredPct: number | null;
  satisfaction: { up: number; down: number; pct: number | null };
  latencyMs: { p50: number | null; p95: number | null };
  daily: { day: string; widget: number; dashboard: number }[];
  topDocuments: { filename: string; citations: number }[];
  actions: Record<string, number>;
};
type Unanswered = { question: string; count: number; lastAsked: string; conversationId: string };

const ACTION_LABELS: Record<string, string> = {
  get_order_status: 'order lookups',
  create_ticket: 'tickets',
  request_callback: 'call-backs',
  handoff_to_human: 'handoffs',
};

const pct = (n: number | null) => (n === null ? '–' : `${n}%`);
const secs = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(1)}s`);
const change = (n: number | null) => (n === null ? 'no earlier data' : `${n >= 0 ? '▲' : '▼'} ${Math.abs(n)}% vs previous period`);
const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 60 / 24)}d ago`;
};

export default function InsightsPage() {
  const router = useRouter();
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [unanswered, setUnanswered] = useState<Unanswered[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const onError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    },
    [router],
  );

  useEffect(() => {
    Promise.all([api<Summary>(`/insights/summary?days=${days}`), api<{ questions: Unanswered[] }>(`/insights/unanswered?days=${days}`)])
      .then(([s, u]) => {
        setSummary(s);
        setUnanswered(u.questions);
      })
      .catch(onError);
  }, [days, onError]);

  return (
    <main className="wide">
      <AppNav />
      <div className="row">
        <div>
          <h1>Insights</h1>
          <p>How your agent is doing, and what customers ask that it can&apos;t answer yet.</p>
        </div>
        <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      {error && <p className="error banner">{error}</p>}
      {!summary && !error && <p>Loading…</p>}

      {summary && (
        <>
          <div className="cards">
            <div className="stat">
              <span className="stat-label">Conversations</span>
              <strong>{summary.conversations}</strong>
              <small className="muted">{change(summary.change.conversations)}</small>
            </div>
            <div className="stat">
              <span className="stat-label">Answered from your docs</span>
              <strong>{pct(summary.answeredFromDocsPct)}</strong>
              <small className="muted">{pct(summary.unansweredPct)} couldn&apos;t be answered</small>
            </div>
            <div className="stat">
              <span className="stat-label">Satisfaction</span>
              <strong>{pct(summary.satisfaction.pct)}</strong>
              <small className="muted">
                👍 {summary.satisfaction.up} · 👎 {summary.satisfaction.down}
              </small>
            </div>
            <div className="stat">
              <span className="stat-label">First word (p95)</span>
              <strong>{secs(summary.latencyMs.p95)}</strong>
              <small className="muted">typical (p50): {secs(summary.latencyMs.p50)}</small>
            </div>
          </div>

          <section className="card">
            <h2>Questions per day</h2>
            <DailyChart days={summary.daily} />
          </section>

          <section className="card">
            <h2>Questions the agent couldn&apos;t answer</h2>
            <p>Add these to your documents and the agent will answer them next time.</p>
            {unanswered.length === 0 ? (
              <p className="muted">Nothing unanswered in this period. 🎉</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Asked</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {unanswered.map((u) => (
                    <tr key={u.question + u.conversationId}>
                      <td>
                        <button className="link" onClick={() => setOpenId(u.conversationId)}>
                          {u.question}
                        </button>
                      </td>
                      <td>{u.count}×</td>
                      <td>{ago(u.lastAsked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="two-col">
            <section className="card">
              <h2>Most-cited documents</h2>
              {summary.topDocuments.length === 0 ? (
                <p className="muted">No citations yet.</p>
              ) : (
                <ol className="ranked">
                  {summary.topDocuments.map((d) => (
                    <li key={d.filename}>
                      <span>{d.filename}</span> <span className="muted">{d.citations}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className="card">
              <h2>Actions taken</h2>
              {Object.keys(summary.actions).length === 0 ? (
                <p className="muted">No tools used yet.</p>
              ) : (
                <ul className="ranked">
                  {Object.entries(summary.actions).map(([tool, n]) => (
                    <li key={tool}>
                      <span>{ACTION_LABELS[tool] ?? tool}</span> <span className="muted">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <ConversationsBrowser onError={onError} openId={openId} />
    </main>
  );
}
