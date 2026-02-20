import db, { generateUUID } from '../db.js';
import type { Job, JobType, JobPayload, EnqueueOptions } from './types.js';

// Jobs stuck in 'processing' longer than this are assumed crashed and reset.
const STUCK_THRESHOLD_MINUTES = 5;

// Base backoff in seconds — doubles with each failed attempt.
// Attempt 0 → 30s, attempt 1 → 60s, attempt 2 → 120s
const BASE_BACKOFF_SECONDS = 30;

export class JobQueue {
  enqueue(type: JobType, payload: JobPayload, opts: EnqueueOptions = {}): string {
    const id = generateUUID();
    const maxRetries = opts.maxRetries ?? 3;
    const now = new Date();
    const nextRunAt = opts.delayMs
      ? new Date(now.getTime() + opts.delayMs).toISOString()
      : now.toISOString();
    const nowIso = now.toISOString();

    db.prepare(`
      INSERT INTO job_queue
        (id, type, payload, status, attempts, max_retries, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `).run(id, type, JSON.stringify(payload), maxRetries, nextRunAt, nowIso, nowIso);

    return id;
  }

  // Atomically picks the next eligible pending job and marks it 'processing'.
  // Uses UPDATE...RETURNING (SQLite 3.35+) — a single write statement, so no
  // SELECT/UPDATE race condition even when multiple processes share the same DB.
  // Returns null if no job is ready.
  dequeueNext(): Job | null {
    const row = db.prepare(`
      UPDATE job_queue
      SET status = 'processing', updated_at = @updatedAt
      WHERE id = (
        SELECT id FROM job_queue
        WHERE status = 'pending'
          AND next_run_at <= @now
        ORDER BY next_run_at ASC
        LIMIT 1
      )
      RETURNING *
    `).get({
      updatedAt: new Date().toISOString(),
      now: new Date().toISOString(),
    }) as Job | undefined;

    return row ?? null;
  }

  markCompleted(id: string): void {
    db.prepare(`
      UPDATE job_queue SET status = 'completed', updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
  }

  markFailed(id: string, error: Error): void {
    const job = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as Job | undefined;
    if (!job) return;

    const attempts = job.attempts + 1;
    const now = new Date().toISOString();

    if (attempts >= job.max_retries) {
      // Exhausted all retries — move to Dead Letter Queue
      db.prepare(`
        UPDATE job_queue
        SET status = 'dead', attempts = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(attempts, error.message, now, id);

      console.log(`[Queue] Job ${id} (${job.type}) moved to DLQ after ${attempts} attempts`);
    } else {
      // Schedule retry with exponential backoff
      const backoffSeconds = BASE_BACKOFF_SECONDS * Math.pow(2, job.attempts);
      const nextRunAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

      db.prepare(`
        UPDATE job_queue
        SET status = 'pending', attempts = ?, last_error = ?, next_run_at = ?, updated_at = ?
        WHERE id = ?
      `).run(attempts, error.message, nextRunAt, now, id);

      console.log(`[Queue] Job ${id} (${job.type}) scheduled retry in ${backoffSeconds}s (attempt ${attempts}/${job.max_retries})`);
    }
  }

  getDead(limit = 50): Job[] {
    return db.prepare(`
      SELECT * FROM job_queue
      WHERE status = 'dead'
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Job[];
  }

  retryDead(id: string): boolean {
    const job = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as Job | undefined;
    if (!job || job.status !== 'dead') return false;

    db.prepare(`
      UPDATE job_queue
      SET status = 'pending', attempts = 0, last_error = NULL, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), id);

    return true;
  }

  discardJob(id: string): boolean {
    const result = db.prepare('DELETE FROM job_queue WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getStatsByStatus(): Record<string, number> {
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count FROM job_queue GROUP BY status
    `).all() as Array<{ status: string; count: number }>;

    return Object.fromEntries(rows.map(r => [r.status, r.count]));
  }

  // Called on worker startup — recovers jobs that were mid-flight when server crashed.
  resetStuck(): number {
    const cutoff = new Date(
      Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000
    ).toISOString();

    const result = db.prepare(`
      UPDATE job_queue
      SET status = 'pending', updated_at = ?
      WHERE status = 'processing' AND updated_at < ?
    `).run(new Date().toISOString(), cutoff);

    return result.changes;
  }
}

// Singleton — import this everywhere instead of instantiating directly.
export const queue = new JobQueue();
