import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { clearDatabase, seedPlatform, seedPost } from '../../fixtures/db.js';
import { createApp } from '../../fixtures/app.js';

const app = createApp();
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;

function slackHeaders(body: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sigBase = `v0:${timestamp}:${body}`;
  const signature = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(sigBase).digest('hex');
  return {
    'x-slack-signature': signature,
    'x-slack-request-timestamp': timestamp,
    'content-type': 'application/x-www-form-urlencoded',
  };
}

function slackPayload(actionId: string, postId: string, userId = 'U123', userName = 'alice'): string {
  const payload = JSON.stringify({
    type: 'block_actions',
    user: { id: userId, name: userName },
    actions: [{ action_id: actionId, value: postId }],
  });
  return `payload=${encodeURIComponent(payload)}`;
}

beforeEach(() => {
  clearDatabase();
});

// ─── POST /slack/actions ─────────────────────────────────────────────────────

describe('POST /slack/actions', () => {
  it('returns 401 when signature headers are missing', async () => {
    const res = await request(app)
      .post('/slack/actions')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send('payload={}');

    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid signature', async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id);
    const body = slackPayload(`approve_${post.id}`, post.id);

    const res = await request(app)
      .post('/slack/actions')
      .set({
        'x-slack-signature': 'v0=invalidsignature',
        'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'content-type': 'application/x-www-form-urlencoded',
      })
      .send(body);

    expect(res.status).toBe(401);
  });

  it('returns 400 for an unknown action type', async () => {
    const body = slackPayload('unknown_action', 'some-id');
    const res = await request(app)
      .post('/slack/actions')
      .set(slackHeaders(body))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid action');
  });

  it('returns 404 when the post does not exist', async () => {
    const body = slackPayload('approve_ghost-id', 'ghost-id');
    const res = await request(app)
      .post('/slack/actions')
      .set(slackHeaders(body))
      .send(body);

    expect(res.status).toBe(404);
  });

  it('returns 200 with job_id on a valid approval', async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'pending' });
    const body = slackPayload(`approve_${post.id}`, post.id);

    const res = await request(app)
      .post('/slack/actions')
      .set(slackHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/approved/i);
    expect(res.body.job_id).toBeTruthy();
  });

  it('returns 200 on a valid rejection', async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'pending' });
    const body = slackPayload(`reject_${post.id}`, post.id);

    const res = await request(app)
      .post('/slack/actions')
      .set(slackHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/rejected/i);
  });

  it('returns 400 when trying to approve an already-actioned post', async () => {
    const platform = seedPlatform();
    const post = seedPost(platform.id, { status: 'approved' });
    const body = slackPayload(`approve_${post.id}`, post.id);

    const res = await request(app)
      .post('/slack/actions')
      .set(slackHeaders(body))
      .send(body);

    expect(res.status).toBe(400);
  });
});
