/** Every embedding in the system has this many numbers; the vector index is built for it. */
export const EMBEDDING_DIMENSIONS = 768;

/** Documents and questions are embedded slightly differently, which improves matching. */
export type EmbedKind = 'document' | 'query';

/** The model asking us to run one of the tools we described to it. */
export type ToolCall = { id?: string; name: string; args: Record<string, unknown> };

export type ChatTurn =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls?: ToolCall[];
      /**
       * The provider's raw reply, replayed verbatim on the next request. Gemini requires this:
       * its tool calls carry a signature that must be sent back unchanged. Opaque to the app.
       */
      providerParts?: unknown;
    }
  | { role: 'tool'; results: { id?: string; name: string; result: unknown }[] };

/** A tool the model may call: what it does and the JSON Schema of its arguments. */
export type ToolDeclaration = { name: string; description: string; parameters: Record<string, unknown> };

export type GenerateRequest = {
  /** Rules the model must follow (kept apart from user content). */
  system: string;
  /** The conversation so far, ending with the turn the model should respond to. */
  turns: ChatTurn[];
  /** Tools the model may ask to use. */
  tools?: ToolDeclaration[];
  /** Aborts generation, e.g. when the user closes the page mid-answer. */
  signal?: AbortSignal;
};

export type GenerateEvent =
  | { type: 'text'; text: string }
  | { type: 'toolCall'; call: ToolCall }
  /** Always last: the raw reply, to put in the next assistant turn's providerParts. */
  | { type: 'end'; providerParts: unknown };

/** What the app needs from a model provider. App code never imports a vendor SDK directly. */
export interface Llm {
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
  /** Streams the reply: text pieces as they're written, tool calls as they're decided. */
  generateStream(request: GenerateRequest): AsyncIterable<GenerateEvent>;
}
