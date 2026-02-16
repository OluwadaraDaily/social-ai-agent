import type { LLMResponse } from '../types.js';

export interface LLMAdapter {
  generatePost(prompt: string, maxTokens?: number): Promise<LLMResponse>;
}
