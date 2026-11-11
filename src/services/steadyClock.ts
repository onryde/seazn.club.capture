import type { ForegroundPort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';
import type { ServerClock } from '@/services/serverClock';

/** How far the wall clock moves against the steady reading before the record says `scoring.clock.jump`. */
export const JUMP_LOG_STEP_MS = 2000;

/**
 * The phone's time for Remote Scoring (controller ruling 137, device finding F5): the wall clock read once, at launch,
 * run on by a monotonic source, so a wall clock moved mid-match (set by hand, corrected by NTP or the carrier, a new time
 * zone) moves nothing while the app is in front. Every football reading of "device now" is this: the clock's reading,
 * Correct's, a tap's stamp, the late-Start resync and the scoring answers' offset samples, so the offset measures the
 * server less THIS clock. A phone wrong at launch is still corrected by the offset.
 *
 * On React Native 0.86.3 `performance.now()` is `NativePerformance.now`, `HighResTimeStamp::now()`, which is
 * `std::chrono::steady_clock` (`ReactCommon/react/timing/primitives.h`): monotonic, and stopped while the CPU sleeps,
 * which it does only with the app away. So at each return to the foreground (ruling 141):
 * - the reading catches up when the wall clock has run ahead of it: the time asleep, or a wall clock set forward while
 *   away, which cannot be told apart. A wall clock set back is never followed: no sleep runs a clock backwards;
 * - the server clock's samples are dropped (`dropSamples`): they measured the clock before the return. The offset
 *   stands until the next answer, whose one sample decides. The focused runner reads at once on the same return
 *   (`scoringMatch`'s `foreground`), so a jump made while away is right as soon as that answer lands. This clock is
 *   built with the ports, before any runner, so it hears the return first and the read is measured on the new clock.
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

type Deps = {
  readonly wall: () => number;
  readonly mono: (() => number) | null;
  readonly logger: Logger;
  readonly foreground: Pick<ForegroundPort, 'subscribe' | 'isForeground'>;
  readonly serverClock: Pick<ServerClock, 'dropSamples'>;
};

/**
 * The steady clock over `wall` (`Date.now`) and `mono` (`monotonicOf(globalThis)`). With no monotonic source it reads
 * the wall clock, and the record says `scoring.clock.steady {monotonic: false}` once.
 *
 * The record says `scoring.clock.jump {ms}` (wall less steady, moved since last said) when the wall has moved
 * {@link JUMP_LOG_STEP_MS} or more against it, judged at a reading made while the app is in front: every reader is a
 * scoring match's (its pad, its taps, its runner's calls), so only while one is open. A return writes no line (ruling
 * 142: a sleep is not a jump), and what moved while away is never said later.
 */
export function createSteadyClock(deps: Deps): SteadyClock {
  const { wall, mono, logger, foreground, serverClock } = deps;
  if (mono === null) {
    logger.info('scoring.clock.steady', { monotonic: false });
    foreground.subscribe(() => serverClock.dropSamples());
    return { nowMs: wall };
  }
  let base = { wallMs: wall(), monoMs: mono() };
  // The wall less the steady reading when last said or last returned: 0 at launch, when both read the same.
  let said = 0;
  const steadyMs = () => Math.round(base.wallMs + (mono() - base.monoMs));
  foreground.subscribe(() => {
    const ahead = wall() - steadyMs();
    if (ahead > 0) base = { wallMs: base.wallMs + ahead, monoMs: base.monoMs };
    said = Math.min(ahead, 0);
    serverClock.dropSamples();
  });
  return {
    nowMs: () => {
      const now = steadyMs();
      const ahead = wall() - now;
      if (foreground.isForeground() && Math.abs(ahead - said) >= JUMP_LOG_STEP_MS) {
        logger.info('scoring.clock.jump', { ms: ahead - said });
        said = ahead;
      }
      return now;
    },
  };
}
