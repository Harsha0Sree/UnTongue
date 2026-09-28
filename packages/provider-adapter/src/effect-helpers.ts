import { AdapterError } from './types.js';

/**
 * Small retry/typed-error helpers for provider adapters.
 * Plain TS so Effect is optional: wrap with Effect.retry when desired,
 * e.g. `Effect.retry(Effect.tryPromise(() => withRetry(...)))`.
 * Keeps the app free of a hard Effect dependency per build spec.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; retryOn?: (e: unknown) => boolean } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 1000;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // Never retry quota/auth/not-implemented - those are terminal and must surface.
      if (e instanceof AdapterError && ['QUOTA_EXHAUSTED', 'AUTH_FAILED', 'NOT_IMPLEMENTED', 'NOT_ELIGIBLE'].includes(e.code)) throw e;
      if (opts.retryOn && !opts.retryOn(e)) throw e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

export function isTerminalAdapterError(e: unknown): boolean {
  return e instanceof AdapterError && ['QUOTA_EXHAUSTED', 'AUTH_FAILED', 'NOT_IMPLEMENTED', 'NOT_ELIGIBLE'].includes(e.code);
}
