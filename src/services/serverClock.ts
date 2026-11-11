import { OFFSET_WINDOW, medianOffset } from '@/domain/scoring/serverOffset';
import type { Logger } from '@/services/logger';

/** How far the offset moves from the value the record last said before the record says it again. */
export const OFFSET_LOG_STEP_MS = 2000;

/**
 * The phone's one estimate of the server's clock (S2-5 design §7.2): fed by every scoring answer's sample
 * (`offsetSampleOf`, through the scoring port's `serverTime`), read by the football clock as `steadyClock.nowMs() +
 * offsetMs()`: each sample is measured against the steady clock too (ruling 137), so the two are one clock.
 * Built once in the ports, before the scoring port it is handed to. It never ticks by itself: it changes only when an
 * answer arrives. Nothing subscribes to it today: the football clock (`useFootballClock`) reads `offsetMs()` when it is
 * read, on its clock leaf's one-second tick and when a button is pressed, so a new sample shows at the next tick.
 * `subscribe` is there for a reader that must redraw on the sample itself; it is never held in context (AGENTS §8).
 */
export type ServerClock = {
  /** How far the server's clock is ahead of this phone's, in ms (negative when behind): 0 until a sample. */
  offsetMs(): number;
  /**
   * The offset only when it is fresh, else null: null before the first sample, and from `dropSamples` until the next
   * sample (ruling 151). What a tap is stamped by and a server stamp's wait is read by (ruling 149): after a return the
   * offset `offsetMs` keeps may be wrong by a wall-clock jump made while away, which a stamp would keep for good. The
   * reading on the screen keeps using `offsetMs` in that window: it is right after a sleep, and a jump shows only until
   * the first answer, never written anywhere.
   */
  freshOffsetMs(): number | null;
  /** One answer's sample of the offset. */
  sample(sampleMs: number): void;
  /**
   * Forgets the samples, keeping the offset until the next sample, which alone then decides (ruling 141): at a return
   * to the foreground the steady clock the samples measured may have moved (`steadyClock.ts`).
   */
  dropSamples(): void;
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
  /** Whether a sample has come since the last `dropSamples` (or ever). */
  let fresh = false;
  const say = offsetSayer(deps.logger);
  const listeners = new Set<() => void>();
  return {
    offsetMs: () => offset ?? 0,
    freshOffsetMs: () => (fresh ? offset : null),
    sample: (sampleMs) => {
      // Only the newest samples count (`medianOffset`); the rest are dropped so a long match keeps five numbers.
      samples = [...samples, sampleMs].slice(-OFFSET_WINDOW);
      fresh = true;
      // Never null: the list holds the sample just taken.
      const next = medianOffset(samples) ?? sampleMs;
      if (next === offset) return;
      offset = next;
      say(next);
      for (const listener of listeners) listener();
    },
    dropSamples: () => {
      samples = [];
      fresh = false;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The record's `scoring.clock.offset {ms}`: said for the first estimate, then once it has moved a step from the last said. */
function offsetSayer(logger: Logger): (ms: number) => void {
  let said: number | null = null;
  return (ms) => {
    if (said !== null && Math.abs(ms - said) < OFFSET_LOG_STEP_MS) return;
    said = ms;
    logger.info('scoring.clock.offset', { ms });
  };
}
