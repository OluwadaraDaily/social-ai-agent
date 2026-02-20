import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './vitest.globalSetup.ts',
    // Run test files sequentially so they share one SQLite file without lock conflicts.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // Fake credentials so modules initialise without throwing
      SLACK_SIGNING_SECRET: 'test-signing-secret-32-chars-long!!',
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_APPROVAL_CHANNEL: 'C0TEST12345',
      OPENAI_API_KEY: 'sk-test-key',
      OPENAI_MODEL: 'gpt-4o-mini',
      LLM_PROVIDER: 'openai',
      X_API_KEY: 'x-test-api-key',
      X_API_SECRET: 'x-test-api-secret',
      X_ACCESS_TOKEN: 'x-test-access-token',
      X_ACCESS_SECRET: 'x-test-access-secret',
    },
  },
});
