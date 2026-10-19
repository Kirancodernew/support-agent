import { createGemini } from './gemini';
import type { Llm } from './types';

export { EMBEDDING_DIMENSIONS, type EmbedKind, type Llm } from './types';

export type LlmConfig = { provider: 'gemini'; apiKey: string; embedModel: string };

export function createLlm(config: LlmConfig): Llm {
  switch (config.provider) {
    case 'gemini':
      return createGemini(config);
  }
}
