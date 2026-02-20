import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearDatabase } from '../fixtures/db.js';
import db from '@/db.js';
import { JobQueue } from '@/queue/index.js';

// Use a fresh JobQueue instance per test file (not the singleton) to avoid state leakage
let queue: JobQueue;

beforeEach(() => {
  clearDatabase();
  queue = new JobQueue();
  vi.useRealTimers();
});

const payload = { postId: 'post-1', message: 'Hello world' };

// ─── enqueue ─────────────────────────────────────────────────────────────────

describe('enqueue', () => {
  it('inserts a pending job and returns its id', () => {
    const id = queue.enqueue('post_to_twitter', payload);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const row = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as any;
    expect(row.status).toBe('pending');
    expect(row.type).toBe('post_to_twitter');
    expect(JSON.parse(row.payload)).toMatchObject(payload);
  });

  it('respects a delayMs option by scheduling next_run_at in the future', () => {
    const before = Date.now();
    const id = queue.enqueue('post_to_twitter', payload, { delayMs: 60_000 });
    const row = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as any;
    const nextRun = new Date(row.next_run_at).getTime();
    expect(nextRun).toBeGreaterThan(before + 59_000);
  });
});

// ─── dequeueNext ─────────────────────────────────────────────────────────────

describe('dequeueNext', () => {
  it('returns null when the queue is empty', () => {
    expect(queue.dequeueNext()).toBeNull();
  });

  it('atomically dequeues the next pending job and marks it processing', () => {
    const id = queue.enqueue('post_to_twitter', payload);
    const job = queue.dequeueNext();

    expect(job).not.toBeNull();
    expect(job!.id).toBe(id);
    expect(job!.status).toBe('processing');

    const row = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as any;
    expect(row.status).toBe('processing');
  });

  it('does not return a job whose next_run_at is in the future', () => {
    queue.enqueue('post_to_twitter', payload, { delayMs: 60_000 });
    expect(queue.dequeueNext()).toBeNull();
  });
});

// ─── markCompleted ───────────────────────────────────────────────────────────

describe('markCompleted', () => {
  it("sets status to 'completed'", () => {
    const id = queue.enqueue('post_to_twitter', payload);
    queue.dequeueNext();
    queue.markCompleted(id);

    const row = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as any;
    expect(row.status).toBe('completed');
  });
});

// ─── markFailed ──────────────────────────────────────────────────────────────

describe('markFailed', () => {
  it('schedules a retry with exponential backoff when retries remain', () => {
    const id = queue.enqueue('post_to_twitter', payload, { maxRetries: 3 });
    queue.dequeueNext();

    const before = Date.now();
    queue.markFailed(id, new Error('transient error'));

    const row = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as any;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe('transient error');
    // first backoff = 30s
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(before + 29_000);
  });

  it("moves to 'dead' status after maxRetries exhausted", () => {
    const id = queue.enqueue('post_to_twitter', payload, { maxRetries: 1 });
    queue.dequeueNext();
    queue.markFailed(id, new Error('fatal'));

    const row = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as any;
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe('fatal');
  });
});

// ─── resetStuck ──────────────────────────────────────────────────────────────

describe('resetStuck', () => {
  it('resets jobs stuck in processing for more than 5 minutes', () => {
    const id = queue.enqueue('post_to_twitter', payload);
    queue.dequeueNext(); // marks as processing

    // Back-date the updated_at to simulate a stale processing job
    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    db.prepare('UPDATE job_queue SET updated_at = ? WHERE id = ?').run(staleTime, id);

    const count = queue.resetStuck();
    expect(count).toBe(1);

    const row = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as any;
    expect(row.status).toBe('pending');
  });

  it('does not touch jobs that have been processing for less than 5 minutes', () => {
    const id = queue.enqueue('post_to_twitter', payload);
    queue.dequeueNext();

    const count = queue.resetStuck();
    expect(count).toBe(0);

    const row = db.prepare('SELECT * FROM job_queue WHERE id = ?').get(id) as any;
    expect(row.status).toBe('processing');
  });
});
