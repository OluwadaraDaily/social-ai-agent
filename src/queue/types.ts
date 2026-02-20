export type JobType = 'post_to_twitter' | 'send_slack_approval';

export interface PostToTwitterPayload {
  postId: string;
  message: string;
}

export interface SendSlackApprovalPayload {
  postId: string;
  message: string;
  platform: string;
}

export type JobPayload = PostToTwitterPayload | SendSlackApprovalPayload;

export interface Job {
  id: string;
  type: JobType;
  payload: string;          // JSON-serialised JobPayload
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead';
  attempts: number;
  max_retries: number;
  last_error: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

export interface EnqueueOptions {
  maxRetries?: number;
  delayMs?: number;         // optional initial delay before first attempt
}
