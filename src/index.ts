import express from 'express';
import dotenv from 'dotenv';
import postsRouter from './routes/posts.js';
import slackRouter from './routes/slack.js';
import { errorHandler } from './middleware/error-handler.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to parse URL-encoded bodies (for Slack)
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Social AI Agent API' });
});

// API routes
app.use('/posts', postsRouter);
app.use('/slack', slackRouter);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
