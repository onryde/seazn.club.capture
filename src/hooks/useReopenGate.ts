import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  expiredModes,
  orphanedSession,
  reopenTarget,
  resumesAtColdStart,
  type ReopenTarget,
  type SavedState,
} from '@/domain/mode/reopen';
import { selectEngineStatus, selectUnpairedName } from '@/hooks/engineSelectors';
import { usePairing } from '@/hooks/usePairing';
import { usePorts } from '@/hooks/usePorts';
import { useUnpair } from '@/hooks/useUnpair';
import { isHomeSubRoute, isStreamSubRoute } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';
import type { ModeStore } from '@/services/modeStore';

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
  const settingsLoaded = useSettingsLoaded();
  const decided = useRef(false);
  const settle = useSettle();

  useEffect(() => {
    void modeStore.load();
  }, [modeStore]);

  // Task 30 (review M12): the cold-start `pair` carries the saved switch, so
  // the first decision waits for the settings too. `load()` never rejects.
  useEffect(() => {
    if (!navigatorReady || status !== 'ready' || !settingsLoaded || decided.current) return;
    decided.current = true;
    settle(true);
    splash.hide();
  }, [navigatorReady, status, settingsLoaded, settle, splash]);

  // Not before the first decision: Expo Router refuses a move before its
  // navigator mounts. Not on the way back from Home's scanner either (I2, R36):
  // that is Play services' activity closing, and Home owns what comes next.
  // The flight is asked on every return, so the one it claims is always spent.
  useEffect(
    () =>
      foreground.subscribe(() => {
        if (!scanFlight.appReturned() && decided.current) settle(false);
      }),
    [foreground, settle, scanFlight],
  );
  useEffect(() => foreground.subscribeBackground(scanFlight.appLeft), [foreground, scanFlight]);
}

/** True once the stream settings have been read (`load()` never rejects, so it always arrives). */
function useSettingsLoaded(): boolean {
  const { streamSettings } = usePorts();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void streamSettings.load().then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [streamSettings]);
  return loaded;
}

/**
 * One decision, from the store and engine as they are now. A store still
 * loading decides nothing (R12: `load()` never rejects, so it always arrives).
 *
 * The amendment (Process death and reopen): at cold start only, an Idle engine
 * with the active stream code saved, unexpired, not `tapToPair` and not named
 * by `unpaired` is re-paired with claim `resume`, and /stream opens on it. A
 * foreground never pairs: closing the permission dialog reads as one.
 *
 * N4 and I1 (final review): the gate clears a session no saved code owns
 * (`orphanedSession`): an ended one is reset, a paired one unpaired
 * (`useUnpair`). It is decided from the same snapshot as the target, in the
 * same tick, so no session that moved on is cleared.
 */
function useSettle(): (coldStart: boolean) => void {
  const { modeStore, engine, navigation, clock, logger, probeFlight } = usePorts();
  const unpair = useUnpair();
  const pair = usePairing();
  return useCallback(
    (coldStart: boolean) => {
      const current = modeStore.getSnapshot();
      if (current.status !== 'ready') return;
      const snapshot = engine.getSnapshot();
      const facts = { engine: selectEngineStatus(snapshot), saved: current.saved };
      const now = clock();
      const stream = current.saved.codes.stream;
      const unpaired = selectUnpairedName(snapshot);
      // Ruling 3 and R2, for a pairing: once, at cold start, and never at a foreground.
      const resumed =
        coldStart && stream !== undefined && resumesAtColdStart({ ...facts, unpaired, now });
      if (resumed) pair(stream, 'resume');
      const target = reopenTarget({ ...facts, now, resumed });
      // N4, I1: a session whose code is gone is cleared on the way Home. F-S4-2: not the dev probe's,
      // whose made-up code no saved code owns; its own clean-up unpairs it.
      if (orphanedSession({ ...facts, now }) && !probeFlight.active()) unpair('orphan');
      expireOnTheWay(modeStore, current.saved, target, now, logger);
      // M22: Settings, with its Diagnostics card, is inside Live Stream; going there is staying. P8: Stream Settings
      // opened from Home is Home's, so a return from App info stays on it.
      const here = navigation.current();
      const staying =
        (target.go === 'stream' && isStreamSubRoute(here)) ||
        (target.go === 'home' && isHomeSubRoute(here));
      if (!staying) navigation.go(target.go);
    },
    [modeStore, clock, engine, navigation, logger, unpair, pair, probeFlight],
  );
}

/**
 * Read the target first: expiring removes the code the notice names. R23:
 * never expire the mode the operator is sent to. A valid code is not expired
 * anyway; an expired one is there because the engine holds it, and the settle
 * after the engine lets go expires it with the notice.
 *
 * R21: a delete the phone refuses leaves the expired code on disk, but the
 * store has already published the removal and the notice, so Home names the
 * expiry either way and the next launch expires it again. The refusal is
 * recorded (spec §5), and nothing escapes as an unhandled rejection.
 */
function expireOnTheWay(
  modeStore: ModeStore,
  saved: SavedState,
  target: ReopenTarget,
  now: Date,
  logger: Logger,
): void {
  const notice = target.go === 'home' ? (target.notice ?? null) : null;
  const expired = expiredModes(saved, now).filter((mode) => mode !== target.go);
  void modeStore
    .expire(expired, notice)
    .catch(() => logger.warn('store.write-refused', { action: 'expire' }));
}
