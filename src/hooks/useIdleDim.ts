import { useEffect } from 'react';
import { IDLE_DIM_MS, shouldDim } from '@/domain/session/idleDim';
import { selectStateKind } from '@/hooks/engineSelectors';
import { LINE_TIER, selectStatusKey } from '@/hooks/statusKey';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useIdleClock } from '@/hooks/useIdleClock';
import { usePorts } from '@/hooks/usePorts';

/**
 * The idle dim (D2 §4.5, R4, R8): the window dims after 30 s with no touch while paired and waiting, and comes back on
 * any touch, on arming or going live, on unpairing, when the app leaves the foreground and when Live Stream unmounts.
 * After the app leaves the foreground nothing counts until it returns, so nothing dims there (`useIdleClock`'s pause).
 * `shouldDim` alone decides, so there is one guard (AGENTS §10). The 30 s are idle time inside paired-and-waiting, so
 * entering it counts as a touch (`useIdleClock`), and so does a new urgent status line (`useUrgentWake`). The returned
 * handler is the touch: the stream layout's root calls it on every touch it sees (`TouchWake`). Keep-awake is
 * separate and unchanged (`useKeepAwake`): this only lowers the brightness of a screen that stays on.
 */
export function useIdleDim(): () => void {
  const { screen, foreground } = usePorts();
  const kind = useEngineSelector(selectStateKind);
  const { idle, wake, pause, resume } = useIdleClock(shouldDim(kind, IDLE_DIM_MS));
  const dim = shouldDim(kind, idle ? IDLE_DIM_MS : 0);
  useEffect(() => {
    if (!dim) return undefined;
    screen.dim();
    return () => screen.restore();
  }, [dim, screen]);
  useUrgentWake(wake);
  useEffect(() => foreground.subscribeBackground(pause), [foreground, pause]);
  useEffect(() => foreground.subscribe(resume), [foreground, resume]);
  return wake;
}

/**
 * A change into a new URGENT status line (`LINE_TIER`: a refusal, a stopped stream, a camera taken) is activity: it
 * wakes the screen and the 30 s start again, so the line is read before the dim. It runs when the key changes, never
 * because an urgent line is still up; a routine line or an advisory caption never wakes it, or a waiting phone would
 * never dim. The line is the engine's (`selectStatusKey`): the silent-engine line is the viewfinder's 1 Hz tick, which
 * the route's root does not take on.
 */
function useUrgentWake(wake: () => void): void {
  const key = useEngineSelector(selectStatusKey);
  const urgent = LINE_TIER[key] === 'urgent';
  useEffect(() => {
    if (urgent) wake();
  }, [key, urgent, wake]);
}
