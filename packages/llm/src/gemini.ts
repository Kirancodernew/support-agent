import { EMBEDDING_DIMENSIONS, type EmbedKind, type Llm } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH_SIZE = 100; // Gemini's limit per batchEmbedContents call
const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const TASK_TYPE: Record<EmbedKind, string> = { document: 'RETRIEVAL_DOCUMENT', query: 'RETRIEVAL_QUERY' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createGemini({ apiKey, embedModel }: { apiKey: string; embedModel: string }): Llm {
  async function embedBatch(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const body = JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${embedModel}`,
        content: { parts: [{ text }] },
        taskType: TASK_TYPE[kind],
        outputDimensionality: EMBEDDING_DIMENSIONS,
      })),
    });

    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${BASE_URL}/models/${embedModel}:batchEmbedContents`, {
        method: 'POST',
        // Key in a header, not the URL, so it never ends up in request logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const data = (await res.json()) as { embeddings: { values: number[] }[] };
        return data.embeddings.map((e) => e.values);
      }
      if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Gemini embed failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      // Rate limited or temporarily down: wait 1s, 2s, 4s (+ jitter so retries don't sync up).
      await sleep(2 ** (attempt - 1) * 1_000 + Math.random() * 250);
    }
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
  };
}
