import type { Logger } from './logger';

export interface RetryOptions {
  attempts?: number;
  onRetry?: (error: unknown, attempt: number) => Promise<void> | void;
  log?: Logger;
}

/**
 * Retry an async operation with optional recovery hook between attempts.
 *
 * Use case: a test fails because the session expired. The `onRetry` hook
 * re-authenticates, then the test runs again.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { attempts = 2, onRetry, log } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (attempt > 1) log?.info(`Retry attempt ${attempt}/${attempts}`);
      return await fn();
    } catch (err) {
      lastError = err;
      log?.warn(`Attempt ${attempt} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < attempts && onRetry) {
        try {
          await onRetry(err, attempt);
        } catch (hookErr) {
          log?.error(`Retry hook failed — aborting retries`, {
            error: hookErr instanceof Error ? hookErr.message : String(hookErr),
          });
          throw hookErr;
        }
      }
    }
  }
  throw lastError;
}
