import { queue } from './index.js';
import { handlePostToTwitter } from './handlers/post_to_twitter.js';
import { handleSendSlackApproval } from './handlers/send_slack_approval.js';
import type { Job, PostToTwitterPayload, SendSlackApprovalPayload } from './types.js';

const POLL_INTERVAL_MS = 5_000;

let intervalId: ReturnType<typeof setInterval> | null = null;

async function processJob(job: Job): Promise<void> {
  const payload: unknown = JSON.parse(job.payload);

  switch (job.type) {
    case 'post_to_twitter':
      await handlePostToTwitter(payload as PostToTwitterPayload);
      break;

    case 'send_slack_approval':
      await handleSendSlackApproval(payload as SendSlackApprovalPayload);
      break;

    default: {
      // TypeScript exhaustiveness guard — compile error if a new JobType is added
      // without a corresponding case here.
      const _exhaustive: never = job.type;
      throw new Error(`Unknown job type: ${String(_exhaustive)}`);
    }
  }
}

async function tick(): Promise<void> {
  const job = queue.dequeueNext();
  if (!job) return;

  console.log(`[Worker] Processing job ${job.id} type=${job.type} attempt=${job.attempts + 1}`);

  try {
    await processJob(job);
    queue.markCompleted(job.id);
    console.log(`[Worker] Job ${job.id} completed`);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    queue.markFailed(job.id, err);
    console.error(`[Worker] Job ${job.id} failed: ${err.message}`);
  }
}

export function startWorker(): void {
  // Recover any jobs left stranded in 'processing' from a previous crash
  const recovered = queue.resetStuck();
  if (recovered > 0) {
    console.log(`[Worker] Recovered ${recovered} stuck job(s) back to pending`);
  }

  intervalId = setInterval(() => {
    tick().catch(err => {
      console.error('[Worker] Unexpected error in tick:', err);
    });
  }, POLL_INTERVAL_MS);

  console.log(`[Worker] Started — polling every ${POLL_INTERVAL_MS / 1000}s`);
}

export function stopWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  console.log('[Worker] Stopped');
}
