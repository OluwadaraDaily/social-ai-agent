export interface Post {
  id: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected' | 'posted' | 'failed_post' | 'failed_approval_send';
  social_platform_id: string;
  external_id?: string;
  approved_at?: string;
  approved_by?: string;
  rejected_by?: string;
  approval_source?: string;
  llm_provider?: string;
  llm_model?: string;
  prompt?: string;
  raw_output?: string;
  created_at: string;
  updated_at: string;
}

export interface SocialPlatform {
  id: string;
  slug: string;
  name: string;
  word_limit: number;
  created_at: string;
  updated_at: string;
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  rawOutput: any;
}

export interface SlackApprovalMetadata {
  channel: string;
  messageTs: string;
  userId?: string;
}
