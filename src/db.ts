import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use isolated test DB when running tests, otherwise use production/dev DB.
const dbPath = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '../data/social_ai_test.db')
  : process.env.DB_PATH ?? path.join(__dirname, '../data/social_ai.db');
const db: BetterSqlite3.Database = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Set WAL for better performance
db.pragma('journal_mode = WAL');

// Create social_platforms table
db.exec(`
  CREATE TABLE IF NOT EXISTS social_platforms (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    word_limit INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Create posts table
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'posted', 'failed_post', 'failed_approval_send')),
    social_platform_id TEXT NOT NULL,
    external_id TEXT,
    approved_at TEXT,
    approved_by TEXT,
    rejected_by TEXT,
    approval_source TEXT,
    llm_provider TEXT,
    llm_model TEXT,
    prompt TEXT,
    raw_output TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (social_platform_id) REFERENCES social_platforms(id) ON DELETE CASCADE
  )
`);

// Create indexes for better query performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
  CREATE INDEX IF NOT EXISTS idx_posts_social_platform_id ON posts(social_platform_id);
  CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
`);

// Create job_queue table for persistent background jobs (retry + DLQ)
db.exec(`
  CREATE TABLE IF NOT EXISTS job_queue (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    next_run_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_job_queue_status_next
    ON job_queue(status, next_run_at)
`);

// Helper function to generate UUID (for use in application code)
export const generateUUID = (): string => {
  return randomUUID();
};

// Export database instance
export default db;
