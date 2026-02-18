import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../db.js';
import { verifySlackSignature } from '../integrations/slack.js';
import { postTweet } from '../integrations/twitter.js';
import type { Post } from '../types.js';

const router = Router();

// POST /slack/actions
router.post('/actions', async (req: Request, res: Response) => {
  try {
    // 1. Verify Slack signature
    const slackSignature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;

    if (!slackSignature || !timestamp) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Use raw body captured by middleware for signature verification
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      return res.status(401).json({ error: 'Missing raw body for verification' });
    }

    const isValid = verifySlackSignature(slackSignature, timestamp, rawBody);

    if (!isValid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Parse payload (Slack sends as form-encoded, but Express with json middleware handles it)
    const payload = typeof req.body.payload === 'string'
      ? JSON.parse(req.body.payload)
      : req.body.payload || req.body;

    // 3. Extract action, postId, and user info
    const action = payload.actions?.[0];
    if (!action) {
      return res.status(400).json({ error: 'No action provided' });
    }

    const actionId = action.action_id;
    const postId = action.value;
    const userId = payload.user?.id;
    const userName = payload.user?.name || payload.user?.username;

    // Determine if approve or reject
    const isApprove = actionId.startsWith('approve_');
    const isReject = actionId.startsWith('reject_');

    if (!isApprove && !isReject) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // 4. Begin database transaction
    const transaction = db.transaction(() => {
      // 5. Query post with row lock (SQLite doesn't have SELECT FOR UPDATE, but transaction provides isolation)
      const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId) as Post | undefined;

      // 6. Check current status
      if (!post) {
        return { success: false, message: 'Post not found' };
      }

      if (post.status !== 'pending') {
        const previousAction = post.status === 'approved' || post.status === 'posted' ? 'approved' : 'rejected';
        return {
          success: false,
          message: `The post has already been ${previousAction}`
        };
      }

      const now = new Date().toISOString();

      // 7. Handle approve action
      if (isApprove) {
        // Update to approved status
        db.prepare(`
          UPDATE posts
          SET status = ?, approved_at = ?, approved_by = ?, updated_at = ?
          WHERE id = ?
        `).run('approved', now, userName || userId, now, postId);

        return { success: true, action: 'approve', post };
      }

      // 8. Handle reject action
      if (isReject) {
        db.prepare(`
          UPDATE posts
          SET status = ?, rejected_by = ?, updated_at = ?
          WHERE id = ?
        `).run('rejected', userName || userId, now, postId);

        return { success: true, action: 'reject' };
      }

      return { success: false, message: 'Invalid action' };
    });

    // Execute transaction
    const result = transaction();

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    // 9. If approved, post to social platform
    if (result.action === 'approve' && result.post) {
      try {
        const tweetResult = await postTweet(result.post.message);
        const now = new Date().toISOString();

        // Update status to posted with external_id
        db.prepare(`
          UPDATE posts
          SET status = ?, external_id = ?, updated_at = ?
          WHERE id = ?
        `).run('posted', tweetResult.id, now, postId);

        return res.json({
          message: 'Post approved and published successfully',
          tweet_id: tweetResult.id
        });
      } catch (error: any) {
        console.error('Failed to post to Twitter:', error);

        // Update status to failed_post
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE posts
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run('failed_post', now, postId);

        return res.status(500).json({
          error: 'Post approved but failed to publish',
          details: error.message
        });
      }
    }

    // 10. Return success response
    res.json({
      message: result.action === 'approve'
        ? 'Post approved successfully'
        : 'Post rejected successfully'
    });
  } catch (error: any) {
    console.error('Error handling Slack action:', error);
    res.status(500).json({
      error: error.message || 'Failed to process action'
    });
  }
});

export default router;
