import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';

/**
 * S0's gap (spec §5): one SecureStore call that never settled held the mode
 * store's serial queue, so every later write — and Home's scan flight behind
 * it — waited forever. No call outlives this; a late answer is ignored.
 */
export const KV_TIMEOUT_MS = 5000;

type Op = 'get' | 'set' | 'delete';

export function withTimeout(
  kv: KeyValueStore,
  deps: { logger: Logger; ms?: number },
): KeyValueStore {
  const guard = timeoutGuard(deps.logger, deps.ms ?? KV_TIMEOUT_MS);
  return {
    get: (key) => guard('get', key, () => kv.get(key)),
    set: (key, value) => guard('set', key, () => kv.set(key, value)),
    delete: (key) => guard('delete', key, () => kv.delete(key)),
  };
}

export function isKvTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'KvTimeoutError';
}

function timeoutGuard(logger: Logger, ms: number) {
  return <T>(op: Op, key: string, run: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        logger.warn('kv.timeout', { op, key, ms });
        reject(timeoutError(op));
      }, ms);
      // `then(run)`, not `run()`: a synchronous throw then reaches the handler
      // below, which clears the timer, instead of rejecting straight out of
      // this executor and being logged as a timeout 5 s later as well.
      Promise.resolve()
        .then(run)
        .then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
}

function timeoutError(op: Op): Error {
  const error = new Error(`key-value ${op} did not settle`);
  error.name = 'KvTimeoutError';
  return error;
}
