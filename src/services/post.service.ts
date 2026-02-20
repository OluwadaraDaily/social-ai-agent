import db, { generateUUID } from '@/db.js';
import { getLLMAdapter } from '@/llm/index.js';
import { postTweet } from '@/integrations/twitter.js';
import { queue } from '@/queue/index.js';
import type { Post, SocialPlatform } from '@/types.js';

// Internal service result types — not domain types, live here not in types.ts

interface GeneratePostResult {
  id: string;
  message: string;
  status: 'pending';
  social_platform: { slug: string; name: string };
}

interface PostDetailResult {
  id: string;
  message: string;
  status: string;
  social_platform: { slug: string; name: string };
  external_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  created_at: string;
  updated_at: string;
}

type ApprovePostResult =
  | { outcome: 'not_found' | 'already_actioned'; message: string }
  | { outcome: 'approved'; message: string };

type RejectPostResult =
  | { outcome: 'not_found' | 'already_actioned'; message: string }
  | { outcome: 'rejected' };

export async function generatePost(
  query: string,
  socialPlatformSlug: string
): Promise<GeneratePostResult> {
  const platform = db
    .prepare('SELECT * FROM social_platforms WHERE slug = ?')
    .get(socialPlatformSlug) as SocialPlatform | undefined;

  if (!platform) {
    throw new Error(`Social platform '${socialPlatformSlug}' not found`);
  }

  const prompt = `Generate a ${platform.name} post about: ${query}

Requirements:
- Maximum ${platform.word_limit} characters
- Engaging and concise
- Professional tone
- Do not include hashtags unless specifically relevant
- Return only the post content, no additional commentary`;

  const llmAdapter = getLLMAdapter();
  const llmResponse = await llmAdapter.generatePost(prompt);

  const postId = generateUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO posts (
      id, message, status, social_platform_id, llm_provider, llm_model,
      prompt, raw_output, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    postId,
    llmResponse.content,
    'pending',
    platform.id,
    llmResponse.provider,
    llmResponse.model,
    prompt,
    JSON.stringify(llmResponse.rawOutput),
    now,
    now
  );

  // Enqueue a durable job instead of fire-and-forget — retries on failure.
  queue.enqueue('send_slack_approval', {
    postId,
    message: llmResponse.content,
    platform: platform.name,
  });

  return {
    id: postId,
    message: llmResponse.content,
    status: 'pending',
    social_platform: { slug: platform.slug, name: platform.name },
  };
}

export function getPostById(id: string): PostDetailResult {
  const post = db.prepare(`
    SELECT
      p.*,
      sp.name as platform_name,
      sp.slug as platform_slug
    FROM posts p
    JOIN social_platforms sp ON p.social_platform_id = sp.id
    WHERE p.id = ?
  `).get(id) as any;

  if (!post) {
    throw new Error('Post not found');
  }

  return {
    id: post.id,
    message: post.message,
    status: post.status,
    social_platform: { slug: post.platform_slug, name: post.platform_name },
    external_id: post.external_id ?? null,
    approved_at: post.approved_at ?? null,
    approved_by: post.approved_by ?? null,
    rejected_by: post.rejected_by ?? null,
    llm_provider: post.llm_provider ?? null,
    llm_model: post.llm_model ?? null,
    created_at: post.created_at,
    updated_at: post.updated_at,
  };
}

// Synchronous: runs a better-sqlite3 transaction (sync by design).
// The transaction guards against double-actions on the same post.
export function approvePost(postId: string, approvedBy: string): ApprovePostResult {
  return db.transaction((): ApprovePostResult => {
    const post = db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .get(postId) as Post | undefined;

    if (!post) {
      return { outcome: 'not_found', message: 'Post not found' };
    }

    if (post.status !== 'pending') {
      const previousAction =
        post.status === 'approved' || post.status === 'posted' ? 'approved' : 'rejected';
      return { outcome: 'already_actioned', message: `The post has already been ${previousAction}` };
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE posts
      SET status = ?, approved_at = ?, approved_by = ?, updated_at = ?
      WHERE id = ?
    `).run('approved', now, approvedBy, now, postId);

    return { outcome: 'approved', message: post.message };
  })();
}

// Synchronous: same pattern as approvePost.
export function rejectPost(postId: string, rejectedBy: string): RejectPostResult {
  return db.transaction((): RejectPostResult => {
    const post = db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .get(postId) as Post | undefined;

    if (!post) {
      return { outcome: 'not_found', message: 'Post not found' };
    }

    if (post.status !== 'pending') {
      const previousAction =
        post.status === 'approved' || post.status === 'posted' ? 'approved' : 'rejected';
      return { outcome: 'already_actioned', message: `The post has already been ${previousAction}` };
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE posts
      SET status = ?, rejected_by = ?, updated_at = ?
      WHERE id = ?
    `).run('rejected', rejectedBy, now, postId);

    return { outcome: 'rejected' };
  })();
}

// Called AFTER approvePost commits — must be outside any transaction.
// On failure, marks the post as failed_post in the DB before throwing.
export async function publishToSocial(
  postId: string,
  message: string
): Promise<{ tweetId: string }> {
  try {
    const tweetResult = await postTweet(message);

    db.prepare(`
      UPDATE posts
      SET status = ?, external_id = ?, updated_at = ?
      WHERE id = ?
    `).run('posted', tweetResult.id, new Date().toISOString(), postId);

    return { tweetId: tweetResult.id };
  } catch (error: any) {
    console.error('Failed to post to Twitter:', error);

    db.prepare(`
      UPDATE posts
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run('failed_post', new Date().toISOString(), postId);

    throw error;
  }
}
