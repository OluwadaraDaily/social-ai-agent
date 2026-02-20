import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearDatabase, seedPlatform, seedPost } from '../fixtures/db.js';
import db from '@/db.js';

// vi.hoisted keeps a stable reference that both the factory and tests share.
const mockGeneratePost = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: 'Mocked post content',
    provider: 'openai',
    model: 'gpt-4o-mini',
    rawOutput: {},
  })
);

// Mock the LLM adapter so no real OpenAI calls are made
vi.mock('../../src/llm/index.js', () => ({
  getLLMAdapter: () => ({ generatePost: mockGeneratePost }),
}));

// Mock Twitter so publishToSocial doesn't hit the real API
vi.mock('../../src/integrations/twitter.js', () => ({
  postTweet: vi.fn().mockResolvedValue({ id: 'tweet-123' }),
}));

import {
  generatePost,
  getPostById,
  approvePost,
  rejectPost,
  publishToSocial,
} from '@/services/post.service.js';
import { postTweet } from '@/integrations/twitter.js';

beforeEach(() => {
  clearDatabase();
  vi.clearAllMocks();
});

// ─── generatePost ───────────────────────────────────────────────────────────

describe('generatePost', () => {
  it('throws when the platform slug does not exist', async () => {
    await expect(generatePost('hello', 'nonexistent')).rejects.toThrow("Social platform 'nonexistent' not found");
  });

  it('creates a pending post in the DB and enqueues a Slack job', async () => {
    seedPlatform('x', 'X', 280);
    const result = await generatePost('AI news', 'x');

    expect(result.status).toBe('pending');
    expect(result.message).toBe('Mocked post content');
    expect(result.social_platform.slug).toBe('x');

    // Post persisted in DB
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.id) as any;
    expect(row).toBeTruthy();
    expect(row.status).toBe('pending');

    // Slack approval job enqueued
    const job = db.prepare("SELECT * FROM job_queue WHERE type = 'send_slack_approval'").get() as any;
    expect(job).toBeTruthy();
    expect(JSON.parse(job.payload).postId).toBe(result.id);
  });

  it('does not write to DB when the LLM throws', async () => {
    mockGeneratePost.mockRejectedValueOnce(new Error('LLM down'));

    seedPlatform('x', 'X', 280);
    await expect(generatePost('AI news', 'x')).rejects.toThrow('LLM down');

    const count = (db.prepare('SELECT COUNT(*) as c FROM posts').get() as any).c;
    expect(count).toBe(0);
  });
});

// ─── getPostById ─────────────────────────────────────────────────────────────

describe('getPostById', () => {
  it('returns the post with platform details', async () => {
    const platform = seedPlatform('x', 'X', 280);
    const post = seedPost(platform.id);

    const result = getPostById(post.id);
    expect(result.id).toBe(post.id);
    expect(result.social_platform.slug).toBe('x');
    expect(result.status).toBe('pending');
  });

  it('throws when the post does not exist', () => {
    expect(() => getPostById('nonexistent-id')).toThrow('Post not found');
  });
});

// ─── approvePost ─────────────────────────────────────────────────────────────

describe('approvePost', () => {
  it("returns 'not_found' for an unknown post id", () => {
    const result = approvePost('no-such-id', 'user1');
    expect(result.outcome).toBe('not_found');
  });

  it('approves a pending post and sets metadata', () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'pending' });

    const result = approvePost(post.id, 'alice');
    expect(result.outcome).toBe('approved');

    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id) as any;
    expect(row.status).toBe('approved');
    expect(row.approved_by).toBe('alice');
    expect(row.approved_at).toBeTruthy();
  });

  it("returns 'already_actioned' when the post is already approved", () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'approved' });

    const result = approvePost(post.id, 'alice');
    expect(result.outcome).toBe('already_actioned');
  });

  it("returns 'already_actioned' when the post is already rejected", () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'rejected' });

    const result = approvePost(post.id, 'alice');
    expect(result.outcome).toBe('already_actioned');
  });
});

// ─── rejectPost ──────────────────────────────────────────────────────────────

describe('rejectPost', () => {
  it("returns 'not_found' for an unknown post id", () => {
    const result = rejectPost('no-such-id', 'user1');
    expect(result.outcome).toBe('not_found');
  });

  it('rejects a pending post and sets rejected_by', () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'pending' });

    const result = rejectPost(post.id, 'bob');
    expect(result.outcome).toBe('rejected');

    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id) as any;
    expect(row.status).toBe('rejected');
    expect(row.rejected_by).toBe('bob');
  });

  it("returns 'already_actioned' on a double-reject", () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'rejected' });

    const result = rejectPost(post.id, 'bob');
    expect(result.outcome).toBe('already_actioned');
  });
});

// ─── publishToSocial ─────────────────────────────────────────────────────────

describe('publishToSocial', () => {
  it("sets status to 'posted' and stores the tweet id on success", async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'approved' });

    const result = await publishToSocial(post.id, post.message);
    expect(result.tweetId).toBe('tweet-123');

    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id) as any;
    expect(row.status).toBe('posted');
    expect(row.external_id).toBe('tweet-123');
  });

  it("sets status to 'failed_post' and rethrows on Twitter error", async () => {
    const mockedPostTweet = postTweet as ReturnType<typeof vi.fn>;
    mockedPostTweet.mockRejectedValueOnce(new Error('Twitter down'));

    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'approved' });

    await expect(publishToSocial(post.id, post.message)).rejects.toThrow('Twitter down');

    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id) as any;
    expect(row.status).toBe('failed_post');
  });
});
