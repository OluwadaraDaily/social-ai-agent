import { Router } from 'express';
import type { Request, Response } from 'express';
import db, { generateUUID } from '../db.js';
import { getLLMAdapter } from '../llm/index.js';
import { sendApprovalMessage } from '../integrations/slack.js';
import { validate, generatePostSchema } from '../middleware/validation.js';
import type { SocialPlatform } from '../types.js';

const router = Router();

// POST /posts/generate
router.post('/generate', validate(generatePostSchema), async (req: Request, res: Response) => {
  const { query, social_platform } = req.body;

  try {
    // 1. Query database for social platform by slug
    const platform = db.prepare('SELECT * FROM social_platforms WHERE slug = ?').get(social_platform) as SocialPlatform | undefined;

    if (!platform) {
      return res.status(404).json({
        error: `Social platform '${social_platform}' not found`
      });
    }

    // 2. Build prompt with platform-specific constraints
    const prompt = `Generate a ${platform.name} post about: ${query}

Requirements:
- Maximum ${platform.word_limit} characters
- Engaging and concise
- Professional tone
- Do not include hashtags unless specifically relevant
- Return only the post content, no additional commentary`;

    // 3. Call LLM adapter to generate content
    const llmAdapter = getLLMAdapter();
    const llmResponse = await llmAdapter.generatePost(prompt);

    // 4. Insert into database
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

    // 5. Send Slack approval message (async, don't block response)
    sendApprovalMessage(postId, llmResponse.content, platform.name)
      .then(metadata => {
        // Update approval_source with Slack metadata
        db.prepare('UPDATE posts SET approval_source = ? WHERE id = ?')
          .run(JSON.stringify(metadata), postId);
      })
      .catch(error => {
        console.error('Failed to send Slack approval:', error);
        // Mark post as failed_approval_send
        db.prepare('UPDATE posts SET status = ? WHERE id = ?')
          .run('failed_approval_send', postId);
      });

    // 6. Return response
    res.status(201).json({
      id: postId,
      message: llmResponse.content,
      status: 'pending',
      social_platform: {
        slug: platform.slug,
        name: platform.name
      }
    });
  } catch (error: any) {
    console.error('Error generating post:', error);

    // Return user-friendly error message
    res.status(500).json({
      error: error.message || 'Unable to generate content right now. Please try again'
    });
  }
});

// GET /posts/:id
router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // Query database with JOIN to get platform info
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
      return res.status(404).json({
        error: 'Post not found'
      });
    }

    // Format response
    res.json({
      id: post.id,
      message: post.message,
      status: post.status,
      social_platform: {
        slug: post.platform_slug,
        name: post.platform_name
      },
      external_id: post.external_id,
      approved_at: post.approved_at,
      approved_by: post.approved_by,
      rejected_by: post.rejected_by,
      llm_provider: post.llm_provider,
      llm_model: post.llm_model,
      created_at: post.created_at,
      updated_at: post.updated_at
    });
  } catch (error: any) {
    console.error('Error fetching post:', error);
    res.status(500).json({
      error: 'Failed to fetch post'
    });
  }
});

export default router;
