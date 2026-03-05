// Generic retry utility with exponential backoff

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  /** Called on each failed attempt before retry */
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTS: Required<Omit<RetryOptions, "onRetry">> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffFactor: 2,
};

/**
 * Execute fn with exponential backoff retry.
 * Delays: initialDelay, initialDelay*factor, initialDelay*factor^2, ...
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_OPTS.maxAttempts;
  const initialDelayMs = opts.initialDelayMs ?? DEFAULT_OPTS.initialDelayMs;
  const backoffFactor = opts.backoffFactor ?? DEFAULT_OPTS.backoffFactor;

  let lastError: Error = new Error("No attempts made");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxAttempts) break;

      const delayMs = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      opts.onRetry?.(attempt, lastError);
      console.warn(
        `[retry] Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${delayMs}ms...`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}
