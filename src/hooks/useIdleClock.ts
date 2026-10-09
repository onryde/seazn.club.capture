import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IDLE_DIM_MS } from '@/domain/session/idleDim';

export type IdleClock = {
  /** `IDLE_DIM_MS` have passed since the last wake. */
  readonly idle: boolean;
  /** Activity: idle ends and the count starts again. */
  readonly wake: () => void;
  /** No count at all (the app left the foreground) until the next wake. */
  readonly pause: () => void;
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
  const timer = useTimer();
  const pause = useCallback(() => {
    timer.stop();
    setIdle(false);
  }, [timer]);
  const wake = useCallback(() => {
    setIdle(false);
    timer.start(() => setIdle(true));
  }, [timer]);
  useEffect(() => {
    wake();
    return timer.stop;
  }, [wake, timer]);
  useEffect(() => {
    if (eligible) wake();
  }, [eligible, wake]);
  return { idle, wake, pause };
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
