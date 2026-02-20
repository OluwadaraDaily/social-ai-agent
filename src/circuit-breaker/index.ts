export class CircuitOpenError extends Error {
  constructor(serviceName: string) {
    super(`Circuit is OPEN for service "${serviceName}" — request rejected to prevent cascade failure`);
    this.name = 'CircuitOpenError';
  }
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  serviceName: string;
  /** Consecutive failures before tripping OPEN */
  failureThreshold: number;
  /** Milliseconds to wait in OPEN before probing (HALF_OPEN) */
  resetTimeoutMs: number;
  /** Consecutive successes in HALF_OPEN before returning to CLOSED */
  successThreshold: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;

  constructor(private readonly config: CircuitBreakerConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.lastFailureTime ?? 0);
      if (elapsed >= this.config.resetTimeoutMs) {
        // Enough time has passed — allow one probe request through
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log(`[CircuitBreaker] ${this.config.serviceName}: OPEN → HALF_OPEN`);
      } else {
        throw new CircuitOpenError(this.config.serviceName);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
        console.log(`[CircuitBreaker] ${this.config.serviceName}: HALF_OPEN → CLOSED`);
      }
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    if (this.state === 'HALF_OPEN') {
      // Any failure during probe sends us straight back to OPEN
      this.state = 'OPEN';
      console.log(`[CircuitBreaker] ${this.config.serviceName}: HALF_OPEN → OPEN`);
      return;
    }

    this.failureCount++;
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
      console.log(
        `[CircuitBreaker] ${this.config.serviceName}: CLOSED → OPEN` +
        ` (${this.failureCount} consecutive failures)`
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
