import OpenAI from 'openai';
import type { LLMAdapter } from './adapter.js';
import type { LLMResponse } from '../types.js';
import { CircuitBreaker } from '../circuit-breaker/index.js';

// Module-level singleton — shared across all OpenAIAdapter instances
const openaiCircuit = new CircuitBreaker({
  serviceName: 'openai',
  failureThreshold: 3,
  resetTimeoutMs: 120_000,  // 2 minutes — LLM outages recover slower
  successThreshold: 2,
});

export class OpenAIAdapter implements LLMAdapter {
  private client: OpenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  async generatePost(prompt: string, maxTokens: number = 500): Promise<LLMResponse> {
    return openaiCircuit.execute(async () => {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a social media content expert. Generate engaging, concise posts that follow the specified character limits and platform guidelines.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: maxTokens,
          temperature: 0.7,
        });

        const content = response.choices[0]?.message?.content || '';

        if (!content) {
          throw new Error('No content generated from OpenAI');
        }

        return {
          content: content.trim(),
          provider: 'openai',
          model: this.model,
          rawOutput: response
        };
      } catch (error) {
        console.error('OpenAI generation error:', error);
        throw new Error('Unable to generate content right now. Please try again');
      }
    });
  }
}
