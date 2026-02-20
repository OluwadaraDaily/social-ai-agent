# Social AI Agent

A backend service that generates social media content using AI, routes posts through a Slack-based human approval workflow, and publishes approved content to Twitter/X.

---

## Table of Contents

- [Architecture Decisions](#architecture-decisions)
- [Setup Instructions](#setup-instructions)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Slack Setup](#slack-setup)
  - [Twitter / X API Keys](#twitter--x-api-keys)
  - [Seeding the Database](#seeding-the-database)
  - [Running the App](#running-the-app)
  - [Running Tests](#running-tests)
- [API Reference](#api-reference)
- [What I Would Improve with More Time](#what-i-would-improve-with-more-time)

---

## Architecture Decisions

### 1. Express 5 + TypeScript (ES Modules)

The app is built on Express 5 and TypeScript because the stack of the company is NodeJS + TS. In addition to that Express gives some amazing features. Express 5 ships with built-in async error propagation, removing the need for `try/catch` wrappers in every route handler. TypeScript strict mode catches type errors at compile time, keeping the codebase maintainable as it grows.

### 2. SQLite via `better-sqlite3` (No ORM)

SQLite with `better-sqlite3` was chosen for simplicity: no database server to run, and the synchronous API makes transactions straightforward without async complexity. Direct SQL with prepared statements avoids ORM overhead and injection risks. WAL mode is enabled for better concurrent read performance, and foreign key constraints are enforced at the database level.

This is a deliberate trade-off — for production scale I would migrate to Postgres, but for this scope SQLite keeps setup friction near zero.

### 3. Service Layer + Route/Controller Separation

Routes are thin: they validate input and call into the service layer. All business logic (post generation, approval, rejection, publishing) lives in `src/services/`. Integrations (Slack, Twitter) are isolated in `src/integrations/`. This separation makes it straightforward to swap implementations, add tests, or move logic to a queue worker without touching HTTP handling.

### 4. LLM Adapter Pattern

The LLM layer is abstracted behind an `LLMAdapter` interface (`src/llm/adapter.ts`). A provider factory (`src/llm/index.ts`) reads the `LLM_PROVIDER` environment variable and returns the appropriate adapter. Only OpenAI is implemented today, but adding Anthropic, Gemini, or any other provider only requires:

1. Creating a new class that implements `LLMAdapter`
2. Adding a case to the factory function

No changes needed in the service layer or routes.

### 5. SQLite-Backed Job Queue with Worker

Rather than fire-and-forget async calls, all side effects (sending Slack approval messages, posting to Twitter) are handled by a persistent job queue backed by the same SQLite database. A polling worker (`src/queue/worker.ts`) runs in-process and picks up jobs every 5 seconds.

It is durable, anything that is stuck or fails can be retried with backoff, there is a dead letter queue to keep track of all dead jobs.

### 6. Slack Signature Verification with Raw Body Capture

Slack requires HMAC-SHA256 signature verification over the raw request body. Express's `json()` middleware parses the body before route handlers run, which destroys the raw bytes needed for verification. To handle this, a custom `urlencoded` middleware with a `verify` callback captures `req.rawBody` before parsing. The Slack action route uses this raw buffer for signature verification, with timing-safe comparison (`crypto.timingSafeEqual`) and a 5-minute replay-attack window.

### 7. Transactional Approval / Rejection

Approve and reject operations are wrapped in SQLite transactions. Before updating, the current post status is checked inside the transaction. If a post has already been actioned, the operation returns a 400 with a clear message. This prevents duplicate approvals or rejections if two team members click simultaneously.

### 8. Status State Machine

Posts move through a defined set of statuses:

```
pending → approved → posted
        ↘ rejected
        ↘ failed_post            (Twitter publish failed after all job retries exhausted)
```

Slack notification delivery and Twitter publishing are both handled by the job queue with retries, so transient failures don't immediately move the post into a terminal error state. The `external_id` field stores the Tweet ID once published, providing an audit trail.

### 9. Layered Rate Limiting

Three rate limiters are applied via `express-rate-limit` middleware (`src/middleware/rate-limit.ts`):

| Limiter | Route | Limit | Rationale |
|---|---|---|---|
| Global | All routes | 100 req / min | Broad abuse prevention |
| Generate | `POST /posts/generate` | 5 req / min | LLM calls are expensive; protects OpenAI quota |
| Slack webhook | `POST /slack/actions` | 30 req / min | Allows approval bursts without being unbounded |

Rate limit metadata is returned in standard `RateLimit-*` response headers (draft-7 spec).

### 10. Seed-Driven Platform Configuration

Social platform configuration (slug, name, character limit) is stored in the database rather than hardcoded. The `social_platforms` table is seeded via `npm run seed`. This lets you add LinkedIn, Threads, Instagram, etc. by adding a seed entry, with no code changes required to support them at the data layer. Also, we can always reference them by slug rather than ID, this makes it deterministic across environments.

---

## Setup Instructions

### Prerequisites

- Node.js 20+
- npm
- A Slack workspace where you have permission to create apps
- A Twitter/X developer account with a project and app

### Environment Variables

Create a `.env` file in the project root:

```env
# Database (optional — defaults to data/social_ai.db relative to the build output)
DB_PATH=...

# Server
PORT=3000

# LLM
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini          # optional, defaults to gpt-4o-mini

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APPROVAL_CHANNEL=C...       # Channel ID (not name) for approval messages

# Twitter / X (OAuth 1.0a)
X_API_KEY=...
X_API_SECRET=...
X_ACCESS_TOKEN=...
X_ACCESS_SECRET=...
```

---

### Slack Setup

1. **Create a Slack App**
   - Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App > From Scratch**.
   - Give it a name (e.g. "Social AI Agent") and select your workspace.

2. **Enable Interactivity**
   - In the left sidebar, go to **Interactivity & Shortcuts**.
   - Toggle **Interactivity** on.
   - Set the **Request URL** to your server's Slack actions endpoint:
     ```
     https://<your-domain>/slack/actions
     ```
   - If developing locally, use a tunnel tool (e.g. `ngrok http 3000`) and paste the HTTPS URL it gives you.
   - Click **Save Changes**.

3. **Add Bot Token Scopes**
   - Go to **OAuth & Permissions > Scopes > Bot Token Scopes**.
   - Add the following scopes:
     - `chat:write` — to post messages
     - `chat:write.public` — to post to channels the bot hasn't joined (optional but useful)

4. **Install the App to Your Workspace**
   - Go to **OAuth & Permissions** and click **Install to Workspace**.
   - Copy the **Bot User OAuth Token** (`xoxb-...`) — this is `SLACK_BOT_TOKEN`.

5. **Get the Signing Secret**
   - Go to **Basic Information > App Credentials**.
   - Copy the **Signing Secret** — this is `SLACK_SIGNING_SECRET`.

6. **Find or Create the Approval Channel**
   - In Slack, right-click the channel you want approval messages posted to, click **View channel details**, and copy the **Channel ID** (starts with `C`).
   - Invite the bot to that channel: `/invite @YourBotName`
   - Set this as `SLACK_APPROVAL_CHANNEL`.

---

### Twitter / X API Keys

1. **Create a Developer Account**
   - Go to [developer.twitter.com](https://developer.twitter.com) and sign up if you haven't already.

2. **Create a Project and App**
   - In the Developer Portal, create a new **Project**, then create an **App** inside it.

3. **Set App Permissions**
   - In your app settings, under **User authentication settings**, click **Set up**.
   - Enable **OAuth 1.0a**.
   - Set **App permissions** to **Read and Write**.
   - Set **Callback URI** to any valid URL (e.g. `http://localhost:3000/callback`) — it won't be used.
   - Save.

4. **Get Your Keys**
   - In the app's **Keys and Tokens** tab:
     - Copy **API Key** → `X_API_KEY`
     - Copy **API Key Secret** → `X_API_SECRET`
   - Under **Authentication Tokens**, generate **Access Token and Secret** (make sure it says *Read and Write*):
     - Copy **Access Token** → `X_ACCESS_TOKEN`
     - Copy **Access Token Secret** → `X_ACCESS_SECRET`

> **Note**: Free-tier Twitter API access only allows posting from the account that owns the app's access token. Upgrade to Basic or higher for broader use.

---

### Seeding the Database

The database file is created automatically on first run. Before generating posts, seed the social platforms table:

```bash
npm run seed
```

This inserts the supported platforms (X with a 280-character limit). To add LinkedIn or Threads, uncomment the relevant entries in [src/seeds/social-platforms.ts](src/seeds/social-platforms.ts) before seeding.

The seed script uses `INSERT OR IGNORE`, so it's safe to run multiple times.

---

### Running the App

**Install dependencies:**

```bash
npm install
```

**Development (with hot reload):**

```bash
npm run dev
```

**Production:**

```bash
npm run build
npm start
```

The server starts on the port defined in `PORT` (default: `3000`).

---

### Running Tests

No credentials or external services are required — all third-party calls (OpenAI, Slack, Twitter) are mocked. Tests run against an isolated `data/social_ai_test.db` file that is created before the suite and deleted automatically afterwards.

```bash
npm test                # Run all tests once
npm run test:watch      # Re-run on file changes
npm run test:coverage   # Generate a coverage report
```

The suite is organised as follows:

| Layer | Files | What's covered |
|---|---|---|
| Unit | `tests/unit/` | CircuitBreaker state machine, Zod validation middleware, Slack HMAC signature verification |
| Integration — services | `tests/integration/post.service.test.ts` | `generatePost`, `approvePost`, `rejectPost`, `publishToSocial` |
| Integration — services | `tests/integration/slack.service.test.ts` | `handleSlackAction` — all outcome paths |
| Integration — queue | `tests/integration/queue.test.ts` | Enqueue, dequeue, exponential-backoff retry, dead-letter queue, stuck-job recovery |
| Integration — routes | `tests/integration/routes/` | HTTP layer via supertest — request validation, signature verification, status codes |

---

## API Reference

### `POST /posts/generate`

Generate a social media post and queue it for Slack approval.

**Request:**
```json
{
  "query": "Announce our new feature that lets users export reports as PDF",
  "social_platform": "x"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "message": "Exciting news! You can now export your reports as PDFs with one click...",
  "status": "pending",
  "social_platform": { "slug": "x", "name": "X" }
}
```

The Slack approval message is sent asynchronously — the response returns immediately.

---

### `GET /posts/:id`

Retrieve the current state of a post.

**Response (200):**
```json
{
  "id": "uuid",
  "message": "...",
  "status": "posted",
  "social_platform": { "slug": "x", "name": "X" },
  "external_id": "1234567890",
  "approved_at": "2024-01-15T10:30:00.000Z",
  "approved_by": "username",
  "rejected_by": null,
  "llm_provider": "openai",
  "llm_model": "gpt-4o-mini",
  "created_at": "2024-01-15T10:29:00.000Z",
  "updated_at": "2024-01-15T10:30:00.000Z"
}
```

---

### `POST /slack/actions` (Internal — called by Slack)

Handles Approve / Reject button clicks from Slack. This endpoint verifies Slack's HMAC-SHA256 signature on every request and is not intended to be called directly.

---

## What I Would Improve with More Time

### Rate Limiting Enhancements

Rate limiting is in place per-IP, but there are meaningful improvements to make:

- **Per-platform daily cap**: No more than N posts queued for a given platform per day, enforced at the database level rather than per-IP.
- **Redis-backed store**: The current in-memory store resets on restart and doesn't share state across multiple server instances. Swap in `rate-limit-redis` for distributed enforcement.
- **Twitter 429 handling**: Twitter publish failures from rate limiting are surfaced as errors but not retried with backoff. The job queue could be extended to detect 429 responses and delay the next retry accordingly.

### Support for More Social Platforms

The database schema and service layer are already platform-aware (each post links to a `social_platforms` row with its own character limit). Expanding to LinkedIn, Threads, Instagram, and Bluesky is largely a matter of:

1. Adding seed entries for each platform.
2. Implementing a publisher function for each platform's API (analogous to `postTweet()`).
3. Adding a `platform` discriminator to the publish routing in the service layer.

The prompt construction already uses the platform's character limit, so LLM output would automatically adjust.

### Authentication and Authorization

The current API has no authentication — anyone who can reach the server can generate posts. I would add:

- **API key auth** as a minimum viable layer for machine-to-machine calls.
- **JWT-based auth** for a future UI, with scopes controlling who can generate vs. view posts.
- **Slack user allowlist**: Currently any Slack workspace member can approve/reject. I would restrict this to a configurable set of user IDs or roles.
- **Secrets management**: Move from `.env` files to a secrets manager (AWS Secrets Manager, HashiCorp Vault) for production deployments.

### Multiple LLM Providers

The adapter pattern is already in place. I would:

- Add an Anthropic adapter (Claude models) and a Google adapter (Gemini).
- Expose `llm_provider` and `llm_model` as optional fields in the generate request, so callers can choose the model per post.
- Implement a fallback chain: if the primary provider fails, retry with a secondary provider before returning an error.
- Store token usage in the database for cost attribution and budget alerting.

### Job Queue Enhancements

The queue is functional but in-process and single-node. With more time:

- **Alerting on dead jobs**: Currently dead-lettered jobs are visible in the database but nothing notifies anyone. A periodic check could post a summary to a Slack ops channel.
- **Admin API**: Expose `GET /admin/jobs` and `POST /admin/jobs/:id/retry` so dead jobs can be retried without needing database access.
- **Scheduled posts**: The worker already polls on a timer; a `scheduled_at` field on the `posts` table would let approvers defer publishing to a specific time with minimal changes.
- **External broker for multi-instance deployments**: The SQLite queue works well for a single server. Moving to BullMQ + Redis (or `pg-boss` alongside a Postgres migration) would allow horizontal scaling.

### Testing

The MVP test suite (65 tests, Vitest) covers the critical path end-to-end with no real network calls. With more time I would extend it with:

- **Worker tests**: The job worker polling loop is not covered — handlers are tested directly. A timer-based integration test would verify the full dispatch cycle.
- **Contract tests**: Pin the exact request/response shapes sent to the Slack and Twitter APIs so a breaking SDK change is caught immediately.
- **Rate limiter tests**: Verify the per-IP limits are enforced correctly under concurrent load.
- **CI pipeline**: Run `npm test` on every pull request with a GitHub Actions workflow.

### Observability

- Structured JSON logging (e.g. `pino`) instead of `console.log` / `console.error`.
- Request tracing with a correlation ID propagated through logs and Slack messages.
- Metrics for post generation latency, approval rate, Twitter publish success rate, and LLM token usage.
- Health check endpoint (`GET /health`) for load balancers and uptime monitors.

### Post Scheduling

Rather than posting to Twitter immediately on approval, allow approvers to schedule a post for a specific time. This would require:

- A `scheduled_at` column on the `posts` table.
- A cron job or queue worker that polls for approved-but-not-yet-posted entries past their scheduled time.
- A Slack message update to reflect the scheduled state.

### Prompt Management

Prompts are currently hardcoded in the service layer. I would extract them into a configurable prompt registry — stored in the database or a config file — so that non-engineers can tune prompts per platform or use-case without a code deployment.
