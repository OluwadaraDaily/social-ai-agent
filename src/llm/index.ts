import type { LLMAdapter } from './adapter.js';
import { OpenAIAdapter } from './openai.js';

export function getLLMAdapter(): LLMAdapter {
  const provider = process.env.LLM_PROVIDER || 'openai';

  if (provider === 'openai') {
    return new OpenAIAdapter();
  }

  // Future: add other providers (Anthropic, etc.)
  throw new Error(`Unsupported LLM provider: ${provider}`);
}

export * from './adapter.js';
