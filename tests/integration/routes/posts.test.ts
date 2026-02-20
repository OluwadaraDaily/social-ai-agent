import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { clearDatabase, seedPlatform, seedPost } from '../../fixtures/db.js';
import { createApp } from '../../fixtures/app.js';

// No real LLM or Twitter calls
vi.mock('../../../src/llm/index.js', () => ({
  getLLMAdapter: () => ({
    generatePost: vi.fn().mockResolvedValue({
      content: 'Generated post content',
      provider: 'openai',
      model: 'gpt-4o-mini',
      rawOutput: {},
    }),
  }),
}));

vi.mock('../../../src/integrations/twitter.js', () => ({
  postTweet: vi.fn().mockResolvedValue({ id: 'tweet-abc' }),
}));

const app = createApp();

beforeEach(() => {
  clearDatabase();
  vi.clearAllMocks();
});

// ─── POST /posts/generate ────────────────────────────────────────────────────

describe('POST /posts/generate', () => {
  it('returns 201 with pending post for a valid request', async () => {
    seedPlatform('x', 'X', 280);

    const res = await request(app)
      .post('/posts/generate')
      .send({ query: 'Latest AI trends', social_platform: 'x' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.message).toBe('Generated post content');
    expect(res.body.social_platform.slug).toBe('x');
    expect(res.body.id).toBeTruthy();
  });

  it('returns 400 when query is missing', async () => {
    const res = await request(app)
      .post('/posts/generate')
      .send({ social_platform: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 when social_platform is missing', async () => {
    const res = await request(app)
      .post('/posts/generate')
      .send({ query: 'hello' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 when query exceeds 1000 characters', async () => {
    const res = await request(app)
      .post('/posts/generate')
      .send({ query: 'a'.repeat(1001), social_platform: 'x' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the platform slug does not exist', async () => {
    const res = await request(app)
      .post('/posts/generate')
      .send({ query: 'hello', social_platform: 'nonexistent' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ─── GET /posts/:id ──────────────────────────────────────────────────────────

describe('GET /posts/:id', () => {
  it('returns 200 with full post details', () => {
    const platform = seedPlatform('x', 'X', 280);
    const post = seedPost(platform.id, { message: 'Hello world', status: 'pending' });

    return request(app)
      .get(`/posts/${post.id}`)
      .expect(200)
      .then(res => {
        expect(res.body.id).toBe(post.id);
        expect(res.body.message).toBe('Hello world');
        expect(res.body.status).toBe('pending');
        expect(res.body.social_platform.slug).toBe('x');
      });
  });

  it('returns 404 for an unknown post id', async () => {
    const res = await request(app).get('/posts/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Post not found');
  });
});
