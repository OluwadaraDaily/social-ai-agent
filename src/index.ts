import express from 'express';
import dotenv from 'dotenv';
import postsRouter from '@/routes/posts.js';
import slackRouter from '@/routes/slack.js';
import { errorHandler } from '@/middleware/error-handler.js';
import { globalLimiter, generatePostLimiter, slackWebhookLimiter } from '@/middleware/rate-limit.js';
import { startWorker, stopWorker } from '@/queue/worker.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Global rate limiter — applied before all routes
app.use(globalLimiter);

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to parse URL-encoded bodies (for Slack)
// Capture raw body for Slack signature verification
app.use(express.urlencoded({
  extended: true,
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Social AI Agent API' });
});

// API routes — per-route limiters applied before their routers
app.use('/posts/generate', generatePostLimiter);
app.use('/posts', postsRouter);

app.use('/slack/actions', slackWebhookLimiter);
app.use('/slack', slackRouter);

// Global error handler (must be last)
app.use(errorHandler);

const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  startWorker();
});

function shutdown(signal: string): void {
  console.log(`[Server] ${signal} received — shutting down gracefully`);
  stopWorker();
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
  // Force exit if server hasn't closed within 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced exit after shutdown timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
