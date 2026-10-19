import { EMBEDDING_DIMENSIONS, type EmbedKind, type GenerateRequest, type Llm } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH_SIZE = 100; // Gemini's limit per batchEmbedContents call
const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const TASK_TYPE: Record<EmbedKind, string> = { document: 'RETRIEVAL_DOCUMENT', query: 'RETRIEVAL_QUERY' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 1s, 2s, 4s (+ jitter so many clients retrying don't hit the API at the same instant).
const backoff = (attempt: number) => sleep(2 ** (attempt - 1) * 1_000 + Math.random() * 250);

type GeminiConfig = { apiKey: string; embedModel: string; chatModel: string };

export function createGemini({ apiKey, embedModel, chatModel }: GeminiConfig): Llm {
  // Key in a header, not the URL, so it never ends up in request logs.
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };

  /** POST with retries for rate limits and outages. Returns the first successful response. */
  async function post(url: string, body: string, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      // Always time out, even when the caller passes its own abort signal: a stalled request
      // must not hang the user's chat forever.
      const timeout = AbortSignal.timeout(30_000);
      const res = await fetch(url, { method: 'POST', headers, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (res.ok) return res;
      const detail = await res.text().catch(() => '');
      // The free tier sometimes signals throttling with an empty-bodied 404 instead of a 429.
      const throttled = RETRYABLE.has(res.status) || (res.status === 404 && detail.trim() === '');
      if (!throttled || attempt === MAX_ATTEMPTS) {
        throw new Error(`Gemini request failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      await backoff(attempt);
    }
  }

  async function embedBatch(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const body = JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${embedModel}`,
        content: { parts: [{ text }] },
        taskType: TASK_TYPE[kind],
        outputDimensionality: EMBEDDING_DIMENSIONS,
      })),
    });
    const res = await post(`${BASE_URL}/models/${embedModel}:batchEmbedContents`, body);
    const data = (await res.json()) as { embeddings: { values: number[] }[] };
    return data.embeddings.map((e) => e.values);
  }

  return {
    async embed(texts, kind) {
      const out: number[][] = [];
      // Sequential batches: gentler on free-tier rate limits than firing them all at once.
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), kind)));
      }
      return out;
    },

    async *generateStream({ system, turns, signal }: GenerateRequest) {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
        // Low temperature: support answers should stick to the sources, not be creative.
        generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
      });
      // Retries only happen before the first word; once streaming has started we can't replay it.
      const res = await post(`${BASE_URL}/models/${chatModel}:streamGenerateContent?alt=sse`, body, signal);
      if (!res.body) throw new Error('Gemini returned no stream');

      // Server-Sent Events: "data: {json}" lines. A network chunk can end mid-line, so buffer.
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6)) as {
            candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
          };
          for (const part of event.candidates?.[0]?.content?.parts ?? []) {
            if (part.text && !part.thought) yield part.text;
          }
        }
      }
    },
  };
}
