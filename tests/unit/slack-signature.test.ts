import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { verifySlackSignature } from '@/integrations/slack.js';

const SECRET = 'test-signing-secret-32-chars-long!!';

function makeSignature(body: string, timestamp: string, secret = SECRET): string {
  const sigBase = `v0:${timestamp}:${body}`;
  const hash = crypto.createHmac('sha256', secret).update(sigBase).digest('hex');
  return `v0=${hash}`;
}

function freshTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('verifySlackSignature', () => {
  const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';

  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
  });

  it('returns true for a valid signature with a fresh timestamp', () => {
    const ts = freshTimestamp();
    const sig = makeSignature(body, ts);
    expect(verifySlackSignature(sig, ts, body)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const ts = freshTimestamp();
    const sig = makeSignature(body, ts);
    expect(verifySlackSignature(sig, ts, body + 'tampered')).toBe(false);
  });

  it('returns false for a wrong signature', () => {
    const ts = freshTimestamp();
    const sig = makeSignature(body, ts, 'wrong-secret-that-is-long-enough!!');
    expect(verifySlackSignature(sig, ts, body)).toBe(false);
  });

  it('returns false for a timestamp older than 5 minutes (replay attack)', () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 301);
    const sig = makeSignature(body, staleTs);
    expect(verifySlackSignature(sig, staleTs, body)).toBe(false);
  });

  it('returns true for a timestamp exactly at the 5-minute boundary', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 300);
    const sig = makeSignature(body, ts);
    expect(verifySlackSignature(sig, ts, body)).toBe(true);
  });

  it('throws when SLACK_SIGNING_SECRET is not set', () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const ts = freshTimestamp();
    const sig = makeSignature(body, ts);
    expect(() => verifySlackSignature(sig, ts, body)).toThrow('SLACK_SIGNING_SECRET');
  });
});
