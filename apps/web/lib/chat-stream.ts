import { ApiError } from './api';

export type ChatSource = { n: number; documentId: string; filename: string; position: number; score: number };

type Handlers = {
  onMeta: (meta: { conversationId: string; sources: ChatSource[] }) => void;
  onToken: (text: string) => void;
  onDone: (stats: { firstTokenMs: number; totalMs: number }) => void;
  onError: (message: string) => void;
};

/**
 * Sends a chat message and reads the answer as Server-Sent Events while it streams.
 * (The browser's EventSource only does GET, so this parses the stream from fetch by hand.)
 */
export async function streamChat(
  body: { message: string; conversationId?: string } & Record<string, unknown>,
  handlers: Handlers,
  signal?: AbortSignal,
  endpoint = '/api/chat',
) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  // Errors before streaming starts (login, validation, rate limit) are ordinary JSON.
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.message ?? 'Something went wrong', data.details);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events end with a blank line; a network chunk can stop mid-event, so keep the remainder.
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const raw of events) {
      const event = /^event: (.*)$/m.exec(raw)?.[1];
      const data = /^data: (.*)$/m.exec(raw)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data);
      if (event === 'meta') handlers.onMeta(payload);
      else if (event === 'token') handlers.onToken(payload.text);
      else if (event === 'done') handlers.onDone(payload);
      else if (event === 'error') handlers.onError(payload.message);
    }
  }
}
