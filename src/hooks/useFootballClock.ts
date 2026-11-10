import type { GameTime } from '@seazn/engine/core';
import { useCallback, useMemo } from 'react';
import { reading } from '@/domain/scoring/footballClock';
import type { FootballDisplay } from '@/domain/scoring/footballTypes';
import { usePorts } from '@/hooks/usePorts';

/** The shared clock read now: its reading in the period, and the stamp a tap pressed now carries. */
export type FootballClockRead = {
  /** Whole seconds into the period, as every screen reads it now (S2-5 design §7.2); 0 before the clock's first event. */
  readonly readingNow: () => number;
  /** The reading as a stamp in the clock's period, or null while the clock has no anchor (a tap then stamps nothing). */
  readonly stampNow: () => GameTime | null;
};

/**
 * The football clock, read at the moment it is asked (S2-5 plan P Task 11): the anchor the fold found, run on to the
 * phone's steady clock (`ports.steadyClock`, ruling 137: a wall clock moved mid-match moves nothing) moved to the
 * server's by the offset the server clock estimates (`ports.serverClock`). It holds no ticking
 * state: a press reads it when it is pressed, and the screen's clock leaf reads it on its own one-second tick (AGENTS §8).
 */
export function useFootballClock(display: FootballDisplay | null): FootballClockRead {
  const { steadyClock, serverClock } = usePorts();
  const anchor = display?.clock.anchor ?? null;
  const readingNow = useCallback(
    () => reading(anchor, { deviceMs: steadyClock.nowMs(), offsetMs: serverClock.offsetMs() }),
    [anchor, steadyClock, serverClock],
  );
  const stampNow = useCallback(
    (): GameTime | null =>
      anchor === null ? null : { period: anchor.period, elapsed: readingNow() },
    [anchor, readingNow],
  );
  return useMemo(() => ({ readingNow, stampNow }), [readingNow, stampNow]);
}
