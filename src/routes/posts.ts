import { Router } from 'express';
import type { Request, Response } from 'express';
import { generatePost, getPostById } from '../services/post.service.js';
import { validate, generatePostSchema } from '../middleware/validation.js';

const router = Router();

// POST /posts/generate
router.post('/generate', validate(generatePostSchema), async (req: Request, res: Response) => {
  const { query, social_platform } = req.body;

  try {
    const result = await generatePost(query, social_platform);
    res.status(201).json(result);
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    console.error('Error generating post:', error);
    res.status(500).json({ error: error.message || 'Unable to generate content right now. Please try again' });
  }
});

// GET /posts/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const result = getPostById(id);
    res.json(result);
  } catch (error: any) {
    if (error.message === 'Post not found') {
      return res.status(404).json({ error: 'Post not found' });
    }
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

export default router;
