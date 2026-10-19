/** Every embedding in the system has this many numbers; the vector index is built for it. */
export const EMBEDDING_DIMENSIONS = 768;

/** Documents and questions are embedded slightly differently, which improves matching. */
export type EmbedKind = 'document' | 'query';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export type GenerateRequest = {
  /** Rules the model must follow (kept apart from user content). */
  system: string;
  /** The conversation so far, ending with the user's turn to answer. */
  turns: ChatTurn[];
  /** Aborts generation, e.g. when the user closes the page mid-answer. */
  signal?: AbortSignal;
};

/** What the app needs from a model provider. App code never imports a vendor SDK directly. */
export interface Llm {
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
  /** Yields the answer in pieces as the model writes it. */
  generateStream(request: GenerateRequest): AsyncIterable<string>;
}
