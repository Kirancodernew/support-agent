'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
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
  id?: string;
};

/** A random id kept per browser, so a visitor's follow-ups stay in their own conversation. */
function visitorId() {
  try {
    const saved = localStorage.getItem('support-agent:visitor');
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem('support-agent:visitor', id);
    return id;
  } catch {
    return crypto.randomUUID(); // storage blocked: works for this page view only
  }
}

/** The website the widget is shown on. Browsers report it to the framed page. */
function pageOrigin() {
  const fromAncestors = window.location.ancestorOrigins?.[0];
  if (fromAncestors) return fromAncestors;
  try {
    return document.referrer ? new URL(document.referrer).origin : undefined;
  } catch {
    return undefined;
  }
}

export function WidgetChat({ publishableKey, businessName }: { publishableKey: string; businessName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const visitor = useRef<string>('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    visitor.current = visitorId();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

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

    try {
      await streamChat(
        { key: publishableKey, visitorId: visitor.current, pageOrigin: pageOrigin(), message, conversationId },
        {
          onMeta: (meta) => {
            setConversationId(meta.conversationId);
            updateLast((m) => ({ ...m, sources: meta.sources }));
          },
          onToken: (text) => updateLast((m) => ({ ...m, content: m.content + text })),
          onTool: (step) => updateLast((m) => ({ ...m, steps: applyToolStep(m.steps, step) })),
          onDone: (stats) => updateLast((m) => ({ ...m, streaming: false, id: stats.messageId })),
          onError: (text) => updateLast((m) => ({ ...m, streaming: false, failed: true, content: m.content || text })),
        },
        undefined,
        '/api/public/chat',
      );
    } catch (err) {
      const text = err instanceof ApiError ? err.message : 'Could not reach the assistant. Try again.';
      updateLast((m) => ({ ...m, streaming: false, failed: true, content: text }));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="widget">
      <header className="widget-header">
        <strong>{businessName} support</strong>
        <button
          className="widget-close"
          aria-label="Close chat"
          // '*' is fine: the message carries no data, and the loader only acts on messages from our origin.
          onClick={() => window.parent.postMessage({ type: 'support-agent:close' }, '*')}
        >
          ×
        </button>
      </header>
      <div className="widget-messages" aria-live="polite">
        {messages.length === 0 && <p className="muted">Hi! Ask me anything about {businessName}.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}${m.failed ? ' failed' : ''}`}>
            <ToolSteps steps={m.steps} />
            <p>{m.content || (m.streaming && !m.steps?.length ? 'Thinking…' : '')}</p>
            {m.role === 'assistant' && m.id && conversationId && (
              <FeedbackButtons
                onRate={(value) =>
                  api('/public/feedback', {
                    method: 'POST',
                    body: JSON.stringify({ key: publishableKey, visitorId: visitor.current, conversationId, messageId: m.id, value }),
                  })
                }
              />
            )}
            {m.role === 'assistant' && !m.streaming && m.sources && m.sources.length > 0 && (
              <div className="sources">
                {m.sources.map((s) => (
                  <span key={s.n} className="chip">
                    [{s.n}] {s.filename}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="widget-input">
        <input name="message" placeholder="Type your question…" maxLength={1000} autoComplete="off" required />
        <button type="submit" disabled={sending}>
          Send
        </button>
      </form>
    </div>
  );
}
