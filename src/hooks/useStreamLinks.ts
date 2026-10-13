import { useCallback, useEffect, useMemo } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { isHomeSubRoute, isStreamSubRoute } from '@/services/devicePorts';

/** The viewfinder's way into Settings (Diagnostics is a card in it, spec §6), open in every state (AGENTS §6). */
export function useStreamLinks(): { settings(): void } {
  const { navigation } = usePorts();
  const settings = useCallback(() => navigation.go('streamSettings'), [navigation]);
  return { settings };
}

/**
 * Back from Settings returns to the camera, and never runs the
 * viewfinder's leave rule. Handled only while Settings is the route (M21):
 * once back on the camera, even before this screen has gone, Back is the
 * viewfinder's, which on air says how to stop.
 */
export function useBackToViewfinder(): () => void {
  const { navigation, back } = usePorts();
  const toCamera = useCallback(() => navigation.go('stream'), [navigation]);
  useEffect(
    () =>
      back.subscribe(() => {
        if (!isStreamSubRoute(navigation.current())) return false;
        toCamera();
        return true;
      }),
    [back, navigation, toCamera],
  );
  return toCamera;
}

/**
 * R2: Home's way into Stream Settings. Not while a scan is in flight: its outcome, an open or a refusal's panel, is
 * Home's, and Settings would take Home away under it (finding 6 of the Batch 10 review). The flight ends on every
 * outcome and on the return from the scanner, so the gear is never left dead.
 */
export function useHomeLinks(): { streamSettings(): void } {
  const { navigation, scanFlight } = usePorts();
  const streamSettings = useCallback(() => {
    if (scanFlight.active()) return;
    navigation.go('homeSettings');
  }, [navigation, scanFlight]);
  return useMemo(() => ({ streamSettings }), [streamSettings]);
}

/** R2: Back from Stream Settings opened from Home returns Home; handled only while that is the route (M21). */
export function useBackToHome(): () => void {
  const { navigation, back } = usePorts();
  const toHome = useCallback(() => navigation.go('home'), [navigation]);
  useEffect(
    () =>
      back.subscribe(() => {
        if (!isHomeSubRoute(navigation.current())) return false;
        toHome();
        return true;
      }),
    [back, navigation, toHome],
  );
  return toHome;
}
