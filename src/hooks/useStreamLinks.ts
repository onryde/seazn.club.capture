import { useCallback, useEffect, useMemo } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { useScoringOrigin } from '@/hooks/useScoringOrigin';
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
 * Home's way into Settings, from the gear in its corner (owner, 2026-11-02). Not while a scan is in flight: its
 * outcome, an open or a refusal's panel, is Home's, and Settings would take Home away under it (finding 6 of the Batch
 * 10 review). The flight ends on every outcome and on the return from the scanner, so the gear is never left dead.
 */
export function useHomeLinks(): { settings(): void } {
  const { navigation, scanFlight } = usePorts();
  const settings = useCallback(() => {
    if (scanFlight.active()) return;
    navigation.go('settings');
  }, [navigation, scanFlight]);
  return useMemo(() => ({ settings }), [settings]);
}

/**
 * Back from Settings, or from Remote Scoring, returns Home; handled only while one of them is the route (M21). From a
 * match opened in Match Day it returns to the day's list instead (S4 design §6, `scoringOrigin`), and only from the
 * pad's own route: Match Day's list and the app's Settings, which share this hook, always go Home.
 */
export function useBackToHome(): () => void {
  const { navigation, back } = usePorts();
  const origin = useScoringOrigin();
  const toList = origin.back === 'matchday';
  const leave = useCallback(
    () => navigation.go(toList && navigation.current() === 'scoring' ? 'matchday' : 'home'),
    [navigation, toList],
  );
  useEffect(
    () =>
      back.subscribe(() => {
        if (!isHomeSubRoute(navigation.current())) return false;
        leave();
        return true;
      }),
    [back, navigation, leave],
  );
  return leave;
}
