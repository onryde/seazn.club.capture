import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { expiredModes, reopenTarget } from '@/domain/mode/reopen';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { usePorts } from '@/hooks/usePorts';

/**
 * Where the app lands, decided before the splash lifts (spec §4): engine
 * first, then the last mode while its code is valid, else Home with the
 * expiry named. Runs again on every return to the foreground, against the
 * clock at that moment — a code can expire in a pocket.
 */
export function useReopenGate(navigatorReady: boolean): void {
  const { modeStore, foreground, splash, scanFlight } = usePorts();
  // Only the status: Shell must not re-render on every store publish.
  const status = useSyncExternalStore(modeStore.subscribe, () => modeStore.getSnapshot().status);
  const decided = useRef(false);
  const settle = useSettle();

  useEffect(() => {
    void modeStore.load();
  }, [modeStore]);

  useEffect(() => {
    if (!navigatorReady || status !== 'ready' || decided.current) return;
    decided.current = true;
    settle();
    splash.hide();
  }, [navigatorReady, status, settle, splash]);

  // Not before the first decision: Expo Router refuses a move before its
  // navigator mounts. Not on the way back from Home's scanner either (I2, R36):
  // that is Play services' activity closing, and Home owns what comes next.
  // The flight is asked on every return, so the one it claims is always spent.
  useEffect(
    () =>
      foreground.subscribe(() => {
        if (!scanFlight.appReturned() && decided.current) settle();
      }),
    [foreground, settle, scanFlight],
  );
  useEffect(() => foreground.subscribeBackground(scanFlight.appLeft), [foreground, scanFlight]);
}

/**
 * One decision, from the store and engine as they are now. A store still
 * loading decides nothing (R12: `load()` never rejects, so it always arrives).
 *
 * R21: a delete the phone refuses leaves the expired code on disk, but the
 * store has already published the removal and the notice, so Home names the
 * expiry either way and the next launch expires it again. The refusal is
 * recorded (spec §5), and nothing escapes as an unhandled rejection.
 */
function useSettle(): () => void {
  const { modeStore, engine, navigation, clock, logger } = usePorts();
  return useCallback(() => {
    const current = modeStore.getSnapshot();
    if (current.status !== 'ready') return;
    const now = clock();
    const target = reopenTarget({
      engine: selectEngineStatus(engine.getSnapshot()),
      saved: current.saved,
      now,
    });
    // Read the target first: expiring removes the code the notice names.
    const notice = target.go === 'home' ? (target.notice ?? null) : null;
    // R23: never expire the mode the operator is sent to. A valid code is not
    // expired anyway; an expired one is there because the engine holds it, and
    // the settle after the engine lets go expires it with the notice.
    const expired = expiredModes(current.saved, now).filter((mode) => mode !== target.go);
    void modeStore
      .expire(expired, notice)
      .catch(() => logger.warn('store.write-refused', { action: 'expire' }));
    navigation.go(target.go);
  }, [modeStore, clock, engine, navigation, logger]);
}
