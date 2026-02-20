import type { LLMAdapter } from './adapter.js';
import { OpenAIAdapter } from './openai.js';

// Reusable Singleton cache
const adapterCache = new Map<string, LLMAdapter>();

export function getLLMAdapter(): LLMAdapter {
  const provider = process.env.LLM_PROVIDER || 'openai';

  const cached = adapterCache.get(provider);
  if (cached) return cached;

  let adapter: LLMAdapter;

  if (provider === 'openai') {
    adapter = new OpenAIAdapter();
  } else {
    // Future: add other providers (Anthropic, etc.)
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  adapterCache.set(provider, adapter);
  return adapter;
}

export * from './adapter.js';
