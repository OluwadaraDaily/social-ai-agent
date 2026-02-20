import express from 'express';
import postsRouter from '@/routes/posts.js';
import slackRouter from '@/routes/slack.js';
import { errorHandler } from '@/middleware/error-handler.js';

/**
 * Creates the Express app wired up exactly as in production,
 * but WITHOUT starting the HTTP server or the job worker.
 * Import this in route tests and pass it directly to supertest.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  // Capture raw body for Slack signature verification (mirrors src/index.ts)
  app.use(
    express.urlencoded({
      extended: true,
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString();
      },
    })
  );

  app.get('/', (_req, res) => {
    res.json({ message: 'Social AI Agent API' });
  });

  app.use('/posts', postsRouter);
  app.use('/slack', slackRouter);

  app.use(errorHandler);

  return app;
}
