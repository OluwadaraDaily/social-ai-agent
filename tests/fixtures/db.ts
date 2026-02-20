import db from '@/db.js';
import { randomUUID } from 'crypto';

/**
 * Wipes all rows from every table between tests.
 * Order matters: job_queue and posts reference social_platforms via FK.
 */
export function clearDatabase(): void {
  db.exec('DELETE FROM job_queue');
  db.exec('DELETE FROM posts');
  db.exec('DELETE FROM social_platforms');
}

/**
 * Inserts a social platform and returns the full row (including generated id).
 */
export function seedPlatform(
  slug = 'x',
  name = 'X',
  wordLimit = 280
): { id: string; slug: string; name: string; word_limit: number } {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO social_platforms (id, slug, name, word_limit) VALUES (?, ?, ?, ?)'
  ).run(id, slug, name, wordLimit);
  return { id, slug, name, word_limit: wordLimit };
}

/**
 * Inserts a post directly into the DB (bypasses the service layer).
 * Useful for setting up a known state before testing approve/reject.
 */
export function seedPost(
  platformId: string,
  overrides: Partial<{
    id: string;
    message: string;
    status: string;
  }> = {}
): { id: string; message: string; status: string; social_platform_id: string } {
  const id = overrides.id ?? randomUUID();
  const message = overrides.message ?? 'Test post content';
  const status = overrides.status ?? 'pending';
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO posts (id, message, status, social_platform_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, message, status, platformId, now, now);

  return { id, message, status, social_platform_id: platformId };
}
