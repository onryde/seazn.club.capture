import { OFFSET_WINDOW, medianOffset } from '@/domain/scoring/serverOffset';
import type { Logger } from '@/services/logger';

/** How far the offset moves from the value the record last said before the record says it again. */
export const OFFSET_LOG_STEP_MS = 2000;

/**
 * The phone's one estimate of the server's clock (S2-5 design §7.2): fed by every scoring answer's sample
 * (`offsetSampleOf`, through the scoring port's `serverTime`), read by the football clock as `Date.now() + offsetMs()`.
 * Built once in the ports, before the scoring port it is handed to. It never ticks by itself: it changes only when an
 * answer arrives, so a screen subscribes to it (`useSyncExternalStore`) and never holds it in context (AGENTS §8).
 */
export type ServerClock = {
  /** How far the server's clock is ahead of this phone's, in ms (negative when behind): 0 until a sample. */
  offsetMs(): number;
  /** One answer's sample of the offset. */
  sample(sampleMs: number): void;
  /** Called each time `offsetMs()` changes; answers the unsubscribe. */
  subscribe(listener: () => void): () => void;
};

/**
 * The record says `scoring.clock.offset {ms}` when the estimate first forms, then each time it has moved
 * {@link OFFSET_LOG_STEP_MS} or more from the value it last said: a phone whose clock is minutes out, or jumps, is in
 * the record once, never once per answer.
 */
export function createServerClock(deps: { readonly logger: Logger }): ServerClock {
  let samples: readonly number[] = [];
  let offset: number | null = null;
  let said: number | null = null;
  const listeners = new Set<() => void>();
  const say = (ms: number): void => {
    if (said !== null && Math.abs(ms - said) < OFFSET_LOG_STEP_MS) return;
    said = ms;
    deps.logger.info('scoring.clock.offset', { ms });
  };
  return {
    offsetMs: () => offset ?? 0,
    sample: (sampleMs) => {
      // Only the newest samples count (`medianOffset`); the rest are dropped so a long match keeps five numbers.
      samples = [...samples, sampleMs].slice(-OFFSET_WINDOW);
      // Never null: the list holds the sample just taken.
      const next = medianOffset(samples) ?? sampleMs;
      if (next === offset) return;
      offset = next;
      say(next);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
