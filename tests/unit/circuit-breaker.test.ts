import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '@/circuit-breaker/index.js';

const makeBreaker = (overrides: Partial<ConstructorParameters<typeof CircuitBreaker>[0]> = {}) =>
  new CircuitBreaker({
    serviceName: 'test-service',
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    successThreshold: 2,
    ...overrides,
  });

const fail = () => Promise.reject(new Error('boom'));
const succeed = () => Promise.resolve('ok');

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('starts in CLOSED state', () => {
    const cb = makeBreaker();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('stays CLOSED while failures are below the threshold', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    await expect(cb.execute(fail)).rejects.toThrow('boom');
    await expect(cb.execute(fail)).rejects.toThrow('boom');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after failureThreshold consecutive failures', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(fail)).rejects.toThrow();
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('throws CircuitOpenError immediately when OPEN', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    await expect(cb.execute(succeed)).rejects.toThrow(CircuitOpenError);
  });

  it('resets failure count on a success (CLOSED state)', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    // Success resets failure count
    await cb.execute(succeed);
    // Two more failures should not open the circuit (count restarted)
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('transitions to HALF_OPEN after resetTimeoutMs', async () => {
    vi.useFakeTimers();
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 500 });

    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    vi.advanceTimersByTime(600);

    // Next call should probe (HALF_OPEN) and succeed
    const result = await cb.execute(succeed);
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('returns to CLOSED after successThreshold successes in HALF_OPEN', async () => {
    vi.useFakeTimers();
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 500, successThreshold: 2 });

    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(600);

    await cb.execute(succeed); // first probe → still HALF_OPEN
    expect(cb.getState()).toBe('HALF_OPEN');

    await cb.execute(succeed); // second probe → CLOSED
    expect(cb.getState()).toBe('CLOSED');
  });

  it('re-opens immediately on failure in HALF_OPEN', async () => {
    vi.useFakeTimers();
    const cb = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 500, successThreshold: 2 });

    await expect(cb.execute(fail)).rejects.toThrow();
    vi.advanceTimersByTime(600);

    // Probe fails → back to OPEN
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');
  });
});
