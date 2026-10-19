import { createGemini } from './gemini';
import type { Llm } from './types';

export {
  EMBEDDING_DIMENSIONS,
  type ChatTurn,
  type EmbedKind,
  type GenerateEvent,
  type GenerateRequest,
  type Llm,
  type ToolCall,
  type ToolDeclaration,
} from './types';

export type LlmConfig = { provider: 'gemini'; apiKey: string; embedModel: string; chatModel: string };

export function createLlm(config: LlmConfig): Llm {
  switch (config.provider) {
    case 'gemini':
      return createGemini(config);
  }
}
