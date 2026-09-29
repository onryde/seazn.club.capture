import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { expiredModes, reopenTarget } from '@/domain/mode/reopen';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { usePorts } from '@/hooks/usePorts';

/**
 * A delete the phone refuses leaves the expired code on disk. The store
 * publishes only after its deletes, so no notice shows; Home still hides the
 * card, because it judges expiry itself. The next return to the foreground
 * tries the delete again. Nothing escapes as an unhandled rejection.
 */
function ignoreRefusedDelete(): void {}

/**
 * Where the app lands, decided before the splash lifts (spec §4): engine
 * first, then the last mode while its code is valid, else Home with the
 * expiry named. Runs again on every return to the foreground, against the
 * clock at that moment — a code can expire in a pocket.
 */
export function useReopenGate(navigatorReady: boolean): void {
  const { modeStore, foreground, splash } = usePorts();
  const snapshot = useSyncExternalStore(modeStore.subscribe, modeStore.getSnapshot);
  const decided = useRef(false);
  const settle = useSettle();

  useEffect(() => {
    void modeStore.load();
  }, [modeStore]);

  useEffect(() => {
    if (!navigatorReady || snapshot.status !== 'ready' || decided.current) return;
    decided.current = true;
    settle();
    splash.hide();
  }, [navigatorReady, snapshot.status, settle, splash]);

  // Not before the first decision: Expo Router refuses a move before its navigator mounts.
  useEffect(
    () =>
      foreground.subscribe(() => {
        if (decided.current) settle();
      }),
    [foreground, settle],
  );
}

/**
 * One decision, from the store and engine as they are now. A store still
 * loading decides nothing (R12: `load()` never rejects, so it always arrives).
 */
function useSettle(): () => void {
  const { modeStore, engine, navigation, clock } = usePorts();
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
    void modeStore.expire(expiredModes(current.saved, now), notice).catch(ignoreRefusedDelete);
    navigation.go(target.go);
  }, [modeStore, clock, engine, navigation]);
}
