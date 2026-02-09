import { logger } from './logger.js';

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableErrors?: string[];
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ThrottlingException'],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const errorCode = (err as { code?: string }).code || '';
      const errorName = (err as { name?: string }).name || '';
      const isRetryable =
        opts.retryableErrors.some((e) => errorCode.includes(e) || errorName.includes(e));

      if (!isRetryable || attempt === opts.maxAttempts) {
        logger.error(`${label} failed after ${attempt} attempt(s)`, {
          error: String(err),
          attempt,
        });
        throw err;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500,
        opts.maxDelayMs
      );

      logger.warn(`${label} attempt ${attempt} failed, retrying in ${Math.round(delay)}ms`, {
        error: String(err),
        attempt,
        nextDelayMs: Math.round(delay),
      });

      await sleep(delay);
    }
  }

  throw new Error(`${label} exhausted all retries`);
}
