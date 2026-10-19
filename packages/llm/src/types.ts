/** Every embedding in the system has this many numbers; the vector index is built for it. */
export const EMBEDDING_DIMENSIONS = 768;

/** Documents and questions are embedded slightly differently, which improves matching. */
export type EmbedKind = 'document' | 'query';

/** What the app needs from a model provider. App code never imports a vendor SDK directly. */
export interface Llm {
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}
