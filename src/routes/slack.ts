import { Router } from 'express';
import type { Request, Response } from 'express';
import { verifySlackSignature } from '@/integrations/slack.js';
import { handleSlackAction } from '@/services/slack.service.js';

const router = Router();

// POST /slack/actions
router.post('/actions', async (req: Request, res: Response) => {
  try {
    // 1. Verify Slack signature (HTTP-layer concern — operates on raw request data)
    const slackSignature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;

    if (!slackSignature || !timestamp) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      return res.status(401).json({ error: 'Missing raw body for verification' });
    }

    const isValid = verifySlackSignature(slackSignature, timestamp, rawBody);
    if (!isValid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Parse Slack payload (translating wire format to typed service inputs)
    const payload = typeof req.body.payload === 'string'
      ? JSON.parse(req.body.payload)
      : req.body.payload || req.body;

    const action = payload.actions?.[0];
    if (!action) {
      return res.status(400).json({ error: 'No action provided' });
    }

    const actionId = action.action_id as string;
    const postId = action.value as string;
    const userId = payload.user?.id as string;
    const userName = (payload.user?.name || payload.user?.username) as string | undefined;

    const isApprove = actionId.startsWith('approve_');
    const isReject = actionId.startsWith('reject_');
    if (!isApprove && !isReject) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // 3. Delegate all business logic to the service
    const result = await handleSlackAction(actionId, postId, userId, userName);

    // 4. Map service outcomes to HTTP responses
    switch (result.outcome) {
      case 'not_found':
        return res.status(404).json({ error: result.message });

      case 'already_actioned':
        return res.status(400).json({ error: result.message });

      case 'rejected':
        return res.json({ message: 'Post rejected successfully' });

      case 'approved_and_queued':
        return res.json({
          message: 'Post approved and queued for publishing',
          job_id: result.jobId,
        });
    }
  } catch (error: any) {
    console.error('Error handling Slack action:', error);
    res.status(500).json({ error: error.message || 'Failed to process action' });
  }
});

export default router;
