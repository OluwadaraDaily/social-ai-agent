import rateLimit from 'express-rate-limit';

// Global limiter — applied to all routes.
// Broad safety net: 100 requests per minute per IP.
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict limiter for POST /posts/generate.
// LLM calls are expensive — cap at 5 per minute per IP.
export const generatePostLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Post generation rate limit exceeded. Please wait before generating another post.' },
});

// Slack webhook limiter for POST /slack/actions.
// Slack sends bursts during active approval flows — allow 30 per minute.
export const slackWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Slack webhook rate limit exceeded.' },
});
