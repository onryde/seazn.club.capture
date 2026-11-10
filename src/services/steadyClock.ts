import type { ForegroundPort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';

/** How far the wall clock moves against the steady reading before the record says `scoring.clock.jump`. */
export const JUMP_LOG_STEP_MS = 2000;

/**
 * The phone's time for Remote Scoring (controller ruling 137, device finding F5): the wall clock read once, at launch,
 * run on by a monotonic source, so a wall clock moved mid-match (set by hand, corrected by NTP or the carrier, a new time
 * zone) moves nothing. Every football reading of "device now" is this: the clock's reading, Correct's, a tap's stamp,
 * the late-Start resync and the scoring answers' offset samples, so the offset measures the server less THIS clock and a
 * jump changes nothing until fresh samples say so. A phone wrong at launch is still corrected by the offset.
 *
 * On React Native 0.86.3 `performance.now()` is `NativePerformance.now`, `HighResTimeStamp::now()`, which is
 * `std::chrono::steady_clock` (`ReactCommon/react/timing/primitives.h`): monotonic, and stopped while the CPU sleeps. So
 * at each return to the foreground the reading catches up when the wall clock has run ahead of it (the time asleep, or a
 * wall clock set forward while away: they cannot be told apart, and the offset follows the second within three answers,
 * as before ruling 137). A wall clock set back is never followed: no sleep runs a clock backwards.
 */
export type SteadyClock = {
  /** Now, in ms since the epoch, on the steady clock. */
  nowMs(): number;
};

/** The platform's monotonic source, `performance.now`, or null where the runtime has none. */
export function monotonicOf(host: { readonly performance?: unknown }): (() => number) | null {
  const { performance } = host;
  if (typeof performance !== 'object' || performance === null) return null;
  const now: unknown = (performance as { now?: unknown }).now;
  return typeof now === 'function' ? () => Number(now.call(performance)) : null;
}

/**
 * The steady clock over `wall` (`Date.now`) and `mono` (`monotonicOf(globalThis)`). With no monotonic source it reads
 * the wall clock, and the record says `scoring.clock.steady {monotonic: false}` once. The record says
 * `scoring.clock.jump {ms}` (wall less steady, moved since last said) when the wall has moved {@link JUMP_LOG_STEP_MS}
 * or more against it, judged at each reading and at each return, so it costs one `Date.now` a reading.
 */
export function createSteadyClock(deps: {
  readonly wall: () => number;
  readonly mono: (() => number) | null;
  readonly logger: Logger;
  readonly foreground: Pick<ForegroundPort, 'subscribe'>;
}): SteadyClock {
  const { wall, mono, logger } = deps;
  if (mono === null) {
    logger.info('scoring.clock.steady', { monotonic: false });
    return { nowMs: wall };
  }
  let base = { wallMs: wall(), monoMs: mono() };
  // The wall less the steady reading when the record last said it: 0 at launch, when both read the same.
  let said = 0;
  const steadyMs = () => Math.round(base.wallMs + (mono() - base.monoMs));
  const drift = (): number => {
    const ahead = wall() - steadyMs();
    if (Math.abs(ahead - said) >= JUMP_LOG_STEP_MS) {
      logger.info('scoring.clock.jump', { ms: ahead - said });
      said = ahead;
    }
    return ahead;
  };
  deps.foreground.subscribe(() => {
    const ahead = drift();
    if (ahead <= 0) return;
    base = { wallMs: base.wallMs + ahead, monoMs: base.monoMs };
    said -= ahead;
  });
  return {
    nowMs: () => {
      drift();
      return steadyMs();
    },
  };
}
