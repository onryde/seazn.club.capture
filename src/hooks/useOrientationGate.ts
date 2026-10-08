import { useEffect, useRef, useState } from 'react';
import {
  INITIAL_TRACKER,
  orientationGate,
  track,
  type GateView,
  type Physical,
  type Target,
} from '@/domain/orientation/orientation';
import { selectBroadcastHeld, selectHoldsOrientation } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import type { MotionPort, OrientationLockPort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';

/**
 * Live Stream's viewfinder is the only landscape-locked route (spec §7). Home and Settings (with Diagnostics
 * inside it) follow the phone. `/stream/settings` is `free` even though it sits inside Live Stream: while a
 * broadcast is held the gate keeps the viewfinder's lock under it (D9). No S1 route targets `portrait`; the
 * portrait target and its turn-upright card are kept for S2/S4.
 */
export function routeTarget(pathname: string): Target {
  return pathname === '/stream' ? 'landscape' : 'free';
}

/**
 * The one orientation controller (spec §5), mounted in the root layout. Reads
 * how the phone is held from the accelerometer. While the phone disagrees with
 * the target it locks to the hands, so the turn card reads upright (R24),
 * unless the engine is on air, when the current lock stays. Locks to the target
 * once they agree, and before any reading has settled (R34). On air with no
 * reading, a kept lock that disagrees with the target shows the target's card
 * (R35), and with nothing locked yet the target is locked (R37); so does a reading that disagrees under a hold,
 * with the target's card. React state
 * changes only when the settled reading or the on-air status does, never per
 * sample or per telemetry tick.
 *
 * The `free` target (Home, Settings; spec §7) follows the phone and shows no card, and what holds it is
 * narrower than what holds a fixed target: only a held broadcast does (Q3, `selectBroadcastHeld`). A paired
 * engine holds nothing there, because those screens cover the viewfinder and native closes the capture (F16).
 */
export function useOrientationGate(target: Target): GateView {
  const physical = usePhysicalOrientation();
  // Module-scope, primitive selectors: a telemetry tick re-renders nothing (AGENTS §8). Both are called every
  // render (rules of hooks); the target picks which one holds the lock.
  const holdsOrientation = useEngineSelector(selectHoldsOrientation);
  const broadcastHeld = useEngineSelector(selectBroadcastHeld);
  const holding = target === 'free' ? broadcastHeld : holdsOrientation;
  const { orientationLock, logger } = usePorts();
  const locked = useRef<Target | null>(null);
  // Cancels the lock attempt in flight (its pending retry). Run by a newer, different lock and on unmount, never by
  // a `keep`: a keep is no lock, so it supersedes nothing.
  const inFlight = useRef<(() => void) | null>(null);
  // The lock last applied (R35, R37). Read in render on purpose: it changes
  // only in the effect below, and only to what this render already decided.
  const view = orientationGate(target, physical, holding, locked.current);
  // R26 forgets a lock refused twice. A view that still asks for a fixed lock with nothing recorded as applied
  // is asked again whenever its inputs change, or a refused landscape lock under a held broadcast on a `free`
  // screen would never be sent again and the activity would follow the phone under the camera. Bounded by the
  // inputs, never a timer: no state change, no third try. A refused `free` unlock is not re-sent this way (R26).
  const unapplied =
    (view.lock === 'landscape' || view.lock === 'portrait') && locked.current === null;
  const evaluation = unapplied ? `${target}|${physical}|${holding}` : '';

  useEffect(() => {
    if (view.lock === 'keep' || view.lock === locked.current) return;
    const wanted = view.lock;
    inFlight.current?.(); // a newer, different lock supersedes the attempt in flight
    locked.current = wanted;
    inFlight.current = lockWithRetry(orientationLock, logger, wanted, () => {
      // R26: forget it, so the next differing lock retries.
      if (locked.current === wanted) locked.current = null;
    });
  }, [view.lock, evaluation, orientationLock, logger]);

  // The screen going away ends the attempt too. (The rule that reads refs in a cleanup only objects to a ref the
  // component never assigns; this one is assigned above.)
  useEffect(() => () => inFlight.current?.(), []);

  return view;
}

/** D26: one retry, half a second on, then forget as S0's R26 did. */
export const LOCK_RETRY_MS = 500;

/**
 * Locks; on a refusal logs it and tries once more. Returns a cancel, which cancels a pending retry. The caller runs
 * it when a newer, different lock supersedes this one and on unmount, never for a `keep`, which is no lock at all.
 * A refused lock whose retry never ran is not applied, so it is forgotten either way (R26).
 */
function lockWithRetry(
  port: OrientationLockPort,
  logger: Logger,
  wanted: Target,
  giveUp: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const attempt = (n: number): void => {
    port.lock(wanted).catch(() => {
      logger.warn('orientation.lock-refused', { lock: wanted, attempt: n });
      if (cancelled || n >= 2) return giveUp();
      timer = setTimeout(() => {
        timer = null;
        attempt(n + 1);
      }, LOCK_RETRY_MS);
    });
  };
  attempt(1);
  return () => {
    cancelled = true;
    if (timer === null) return;
    clearTimeout(timer);
    giveUp();
  };
}

function usePhysicalOrientation(): Physical {
  const { motion, logger } = usePorts();
  const [physical, setPhysical] = useState<Physical>('unknown');
  useEffect(() => watchPhysical(motion, logger, setPhysical), [motion, logger]);
  return physical;
}

/**
 * Feeds settled readings to `onSettled` and returns the unsubscribe. No
 * accelerometer reads as `flat`: never block the operator behind a card (spec §5).
 */
function watchPhysical(
  motion: MotionPort,
  logger: Logger,
  onSettled: (physical: Physical) => void,
): () => void {
  let tracker = INITIAL_TRACKER;
  let unsubscribe: (() => void) | null = null;
  let alive = true;
  // R26: a failed check counts as no accelerometer, and is recorded.
  const availability = motion.isAvailable().catch(() => {
    logger.warn('motion.check-failed');
    return false;
  });
  void availability.then((available) => {
    if (!alive) return;
    if (!available) return onSettled('flat');
    unsubscribe = motion.subscribe((g, atMs) => {
      tracker = track(tracker, g, atMs);
      onSettled(tracker.settled);
    });
  });
  return () => {
    alive = false;
    unsubscribe?.();
  };
}
