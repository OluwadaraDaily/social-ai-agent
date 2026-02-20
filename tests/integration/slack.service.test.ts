import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase, seedPlatform, seedPost } from '../fixtures/db.js';
import db from '@/db.js';
import { handleSlackAction } from '@/services/slack.service.js';

beforeEach(() => {
  clearDatabase();
});

describe('handleSlackAction', () => {
  it("returns 'not_found' when the post does not exist", async () => {
    const result = await handleSlackAction('approve_no-such-id', 'no-such-id', 'U123', 'alice');
    expect(result.outcome).toBe('not_found');
  });

  it("approves a pending post and enqueues a Twitter job ('approved_and_queued')", async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'pending' });

    const result = await handleSlackAction(`approve_${post.id}`, post.id, 'U123', 'alice');
    expect(result.outcome).toBe('approved_and_queued');
    if (result.outcome !== 'approved_and_queued') return;
    expect(result.jobId).toBeTruthy();

    // Post updated in DB
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id) as any;
    expect(row.status).toBe('approved');
    expect(row.approved_by).toBe('alice');

    // Twitter job was enqueued
    const job = db.prepare("SELECT * FROM job_queue WHERE id = ?").get(result.jobId) as any;
    expect(job).toBeTruthy();
    expect(job.type).toBe('post_to_twitter');
    expect(JSON.parse(job.payload).postId).toBe(post.id);
  });

  it("rejects a pending post ('rejected')", async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'pending' });

    const result = await handleSlackAction(`reject_${post.id}`, post.id, 'U456', 'bob');
    expect(result.outcome).toBe('rejected');

    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id) as any;
    expect(row.status).toBe('rejected');
    expect(row.rejected_by).toBe('bob');
  });

  it("returns 'already_actioned' when attempting to approve an already-approved post", async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'approved' });

    const result = await handleSlackAction(`approve_${post.id}`, post.id, 'U123', 'alice');
    expect(result.outcome).toBe('already_actioned');
  });

  it("returns 'already_actioned' when attempting to reject an already-rejected post", async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'rejected' });

    const result = await handleSlackAction(`reject_${post.id}`, post.id, 'U456', 'bob');
    expect(result.outcome).toBe('already_actioned');
  });

  it('uses userId as actor when userName is undefined', async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'pending' });

    await handleSlackAction(`reject_${post.id}`, post.id, 'U999', undefined);

    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id) as any;
    expect(row.rejected_by).toBe('U999');
  });
});
