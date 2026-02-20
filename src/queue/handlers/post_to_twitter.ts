import { publishToSocial } from '@/services/post.service.js';
import type { PostToTwitterPayload } from '@/queue/types.js';

// publishToSocial handles its own DB updates:
//   success → posts.status = 'posted', external_id = tweetId
//   failure → posts.status = 'failed_post', then throws
// On throw the worker calls markFailed() — queue handles the retry schedule.
export async function handlePostToTwitter(payload: PostToTwitterPayload): Promise<void> {
  await publishToSocial(payload.postId, payload.message);
}
