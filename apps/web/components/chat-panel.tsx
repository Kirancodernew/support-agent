'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type ErrorHandler } from '@/lib/api';
import { streamChat, type ChatSource, type ToolStep } from '@/lib/chat-stream';
import { FeedbackButtons } from './feedback-buttons';
import { applyToolStep, ToolSteps } from './tool-steps';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  steps?: ToolStep[];
  streaming?: boolean;
  failed?: boolean;
  firstTokenMs?: number;
  id?: string;
};

/** Try the agent on your own documents: answers stream in with their sources. */
export function ChatPanel({ onError }: { onError: ErrorHandler }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Stop an in-flight answer if the panel goes away.
  useEffect(() => () => abortRef.current?.abort(), []);
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only
  // return a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  // Updates the answer being streamed (always the last message).
  const updateLast = (change: (m: Message) => Message) =>
    setMessages((all) => [...all.slice(0, -1), change(all[all.length - 1]!)]);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const message = String(new FormData(form).get('message') ?? '').trim();
    if (!message || sending) return;
    form.reset();

    setSending(true);
    setMessages((all) => [...all, { role: 'user', content: message }, { role: 'assistant', content: '', streaming: true }]);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await streamChat(
        { message, conversationId },
        {
          onMeta: (meta) => {
            setConversationId(meta.conversationId);
            updateLast((m) => ({ ...m, sources: meta.sources }));
          },
          onToken: (text) => updateLast((m) => ({ ...m, content: m.content + text })),
          onTool: (step) => updateLast((m) => ({ ...m, steps: applyToolStep(m.steps, step) })),
          onDone: (stats) => updateLast((m) => ({ ...m, streaming: false, firstTokenMs: stats.firstTokenMs, id: stats.messageId })),
          onError: (text) => updateLast((m) => ({ ...m, streaming: false, failed: true, content: m.content || text })),
        },
        abort.signal,
      );
    } catch (err) {
      setMessages((all) => all.slice(0, -2)); // take back the unanswered question
      if (!abort.signal.aborted) onError(err);
    } finally {
      setSending(false);
    }
  }

  function newConversation() {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(undefined);
  }

  return (
    <section className="card">
      <div className="row">
        <div>
          <h2>Chat</h2>
          <p>Ask what your customers would ask. Answers come only from your documents.</p>
        </div>
        {messages.length > 0 && (
          <button className="secondary" onClick={newConversation}>
            New conversation
          </button>
        )}
      </div>

      {messages.length > 0 && (
        <div className="chat" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}${m.failed ? ' failed' : ''}`}>
              <ToolSteps steps={m.steps} />
              <p>{m.content || (m.streaming && !m.steps?.length ? 'Thinking…' : '')}</p>
              {m.role === 'assistant' && !m.streaming && m.sources && m.sources.length > 0 && (
                <div className="sources">
                  {m.sources.map((s) => (
                    <span key={s.n} className="chip" title={`match ${Math.round(s.score * 100)}%`}>
                      [{s.n}] {s.filename}
                    </span>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && m.id && conversationId && (
                <FeedbackButtons
                  onRate={(value) =>
                    api(`/conversations/${conversationId}/feedback`, { method: 'POST', body: JSON.stringify({ messageId: m.id, value }) })
                  }
                />
              )}
              {m.firstTokenMs !== undefined && (
                <small className="muted">first word in {(m.firstTokenMs / 1000).toFixed(1)}s</small>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      <form onSubmit={send} className="inline-form">
        <input name="message" placeholder="e.g. How long does shipping take?" maxLength={1000} autoComplete="off" required />
        <button type="submit" disabled={sending}>
          {sending ? 'Answering…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
