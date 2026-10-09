import { useCallback, useEffect, useRef, useState } from 'react';
import { IDLE_DIM_MS, shouldDim } from '@/domain/session/idleDim';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';

/**
 * The idle dim (D2 §4.5, R4, R8): the window dims after 30 s with no touch while paired and waiting, and comes back on
 * any touch, on arming or going live, on unpairing, when the app leaves the foreground and when Live Stream unmounts.
 * The idle timer runs whatever the state; `shouldDim` alone decides, so there is one guard (AGENTS §10). The returned
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
