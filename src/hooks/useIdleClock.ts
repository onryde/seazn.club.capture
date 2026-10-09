import { useEffect, useMemo, useRef, useState } from 'react';
import { IDLE_DIM_MS } from '@/domain/session/idleDim';

export type IdleClock = {
  /** `IDLE_DIM_MS` have passed since the last wake. */
  readonly idle: boolean;
  /** Activity: idle ends and the count starts again, unless paused. */
  readonly wake: () => void;
  /** The app left the foreground: idle ends, and nothing counts, whatever wakes it, until `resume`. */
  readonly pause: () => void;
  /** The app is back in the foreground: the pause ends and it wakes, so the 30 s count from the return. */
  readonly resume: () => void;
};

/**
 * The idle dim's clock (D2 §4.5). It counts from mount. `eligible` turning true (paired and waiting) is a wake from its
 * first render: idle is reset in render, so a stale idle from another state never reaches a commit (an effect alone
 * would dim, then restore), and the count starts again in an effect.
 */
export function useIdleClock(eligible: boolean): IdleClock {
  const [idle, setIdle] = useState(false);
  const [eligibleBefore, setEligibleBefore] = useState(eligible);
  if (eligible !== eligibleBefore) {
    setEligibleBefore(eligible);
    if (eligible) setIdle(false);
  }
  const { wake, pause, resume, stop } = useCount(setIdle);
  useEffect(() => {
    wake();
    return stop;
  }, [wake, stop]);
  useEffect(() => {
    if (eligible) wake();
  }, [eligible, wake]);
  return { idle, wake, pause, resume };
}

type Count = Omit<IdleClock, 'idle'> & { readonly stop: () => void };

/**
 * The count's moves over one timer. Paused (the app is in the background, B5 review I1), a wake ends idle but starts
 * nothing, so a change there (entering paired, an urgent line, a remote stop on a locked phone, D3 row 2b) never dims a
 * window nobody sees, and the phone comes back bright. The same object for life.
 */
function useCount(setIdle: (idle: boolean) => void): Count {
  const timer = useTimer();
  const paused = useRef(false);
  return useMemo(() => {
    const wake = () => {
      setIdle(false);
      if (!paused.current) timer.start(() => setIdle(true));
    };
    const pause = () => {
      paused.current = true;
      timer.stop();
      setIdle(false);
    };
    const resume = () => {
      paused.current = false;
      wake();
    };
    return { wake, pause, resume, stop: timer.stop };
  }, [timer, setIdle]);
}

/** One pending `IDLE_DIM_MS` timeout at a time: `start` replaces it, `stop` clears it. The same object for life. */
function useTimer(): { readonly start: (fire: () => void) => void; readonly stop: () => void } {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useMemo(() => {
    const stop = () => {
      if (pending.current !== null) clearTimeout(pending.current);
      pending.current = null;
    };
    const start = (fire: () => void) => {
      stop();
      pending.current = setTimeout(() => {
        pending.current = null;
        fire();
      }, IDLE_DIM_MS);
    };
    return { start, stop };
  }, []);
}
