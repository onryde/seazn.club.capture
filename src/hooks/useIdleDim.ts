import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE_DIM_MS, shouldDim } from '@/domain/session/idleDim';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/**
 * The idle dim (D2 §4.5, R4, R8): the window dims after 30 s with no touch while paired and waiting, and comes back on
 * any touch, on arming or going live, on unpairing, when the app leaves the foreground and when Live Stream unmounts.
 * `shouldDim` alone decides, so there is one guard (AGENTS §10). The 30 s are idle time inside paired-and-waiting, so
 * entering it counts as a touch: a new line ("stopped by organiser") is always read before the dim. The returned
 * handler is the touch: the stream layout's root calls it on every touch it sees (`TouchWake`). Keep-awake is
 * separate and unchanged (`useKeepAwake`): this only lowers the brightness of a screen that stays on.
 */
export function useIdleDim(): () => void {
  const { screen, foreground } = usePorts();
  const kind = useEngineSelector(selectStateKind);
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const touched = useCallback(() => {
    stop();
    setIdle(false);
    timer.current = setTimeout(() => {
      timer.current = null;
      setIdle(true);
    }, IDLE_DIM_MS);
  }, [stop]);
  const mayDim = shouldDim(kind, IDLE_DIM_MS);
  const [mayDimBefore, setMayDimBefore] = useState(mayDim);
  if (mayDim !== mayDimBefore) {
    // Entering paired-and-waiting is a touch from its first render: reset here, in render, a stale idle from another
    // state never reaches a commit, so the window never dims on arrival (an effect would dim, then restore).
    setMayDimBefore(mayDim);
    if (mayDim) setIdle(false);
  }
  const dim = shouldDim(kind, idle ? IDLE_DIM_MS : 0);
  useEffect(() => {
    if (!dim) return undefined;
    screen.dim();
    return () => screen.restore();
  }, [dim, screen]);
  useEffect(() => {
    touched();
    return stop;
  }, [touched, stop]);
  // ...and the 30 s start again from it.
  useEffect(() => {
    if (mayDim) touched();
  }, [mayDim, touched]);
  useEffect(
    () =>
      foreground.subscribeBackground(() => {
        stop();
        setIdle(false);
      }),
    [foreground, stop],
  );
  useEffect(() => foreground.subscribe(touched), [foreground, touched]);
  return touched;
}
