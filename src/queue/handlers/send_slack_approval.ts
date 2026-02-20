import db from '../../db.js';
import { sendApprovalMessage } from '../../integrations/slack.js';
import type { SendSlackApprovalPayload } from '../types.js';

// On success: saves the Slack message metadata (channel + ts) back to the post.
// On throw: worker calls markFailed() and the job is retried with backoff.
export async function handleSendSlackApproval(payload: SendSlackApprovalPayload): Promise<void> {
  const metadata = await sendApprovalMessage(payload.postId, payload.message, payload.platform);

  db.prepare('UPDATE posts SET approval_source = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(metadata), new Date().toISOString(), payload.postId);
}
