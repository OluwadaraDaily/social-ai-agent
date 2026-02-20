import { approvePost, rejectPost } from './post.service.js';
import { queue } from '../queue/index.js';

export type SlackActionResult =
  | { outcome: 'not_found';          message: string }
  | { outcome: 'already_actioned';   message: string }
  | { outcome: 'rejected' }
  | { outcome: 'approved_and_queued'; jobId: string };

export async function handleSlackAction(
  actionId: string,
  postId: string,
  userId: string,
  userName: string | undefined
): Promise<SlackActionResult> {
  const isApprove = actionId.startsWith('approve_');
  const actor = userName || userId;

  if (!isApprove) {
    // reject path
    const result = rejectPost(postId, actor);
    if (result.outcome === 'not_found' || result.outcome === 'already_actioned') {
      return result;
    }
    return { outcome: 'rejected' };
  }

  // approve path
  const approveResult = approvePost(postId, actor);
  if (approveResult.outcome === 'not_found' || approveResult.outcome === 'already_actioned') {
    return approveResult;
  }

  // Transaction committed — enqueue a durable Twitter job instead of posting synchronously.
  // The worker will retry with backoff on failure and move to DLQ after max_retries.
  const jobId = queue.enqueue('post_to_twitter', {
    postId,
    message: approveResult.message,
  });

  return { outcome: 'approved_and_queued', jobId };
}
