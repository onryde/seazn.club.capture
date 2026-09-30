import { useEffect, useRef, useState } from 'react';
import {
  INITIAL_TRACKER,
  orientationGate,
  track,
  type GateView,
  type Physical,
  type Target,
} from '@/domain/orientation/orientation';
import { selectHoldsOrientation } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import type { MotionPort, OrientationLockPort } from '@/services/devicePorts';
import type { Logger } from '@/services/logger';

/** Live Stream is the only landscape mode (decision record ruling 4). */
export function routeTarget(pathname: string): Target {
  return pathname === '/stream' || pathname.startsWith('/stream/') ? 'landscape' : 'portrait';
}

/**
 * The one orientation controller (spec §5), mounted in the root layout. Reads
 * how the phone is held from the accelerometer. While the phone disagrees with
 * the target it locks to the hands, so the turn card reads upright (R24),
 * unless the engine is on air, when the current lock stays. Locks to the target
 * once they agree, and before any reading has settled (R34). On air with no
 * reading, a kept lock that disagrees with the target shows the target's card
 * (R35), and with nothing locked yet the target is locked (R37). React state
 * changes only when the settled reading or the on-air status does, never per
 * sample or per telemetry tick.
 */
export function useOrientationGate(target: Target): GateView {
  const physical = usePhysicalOrientation();
  // Module-scope, primitive selector: a telemetry tick re-renders nothing (AGENTS §8).
  const onAir = useEngineSelector(selectHoldsOrientation);
  const { orientationLock, logger } = usePorts();
  const locked = useRef<Target | null>(null);
  // The lock last applied (R35, R37). Read in render on purpose: it changes
  // only in the effect below, and only to what this render already decided.
  const view = orientationGate(target, physical, onAir, locked.current);

  useEffect(() => {
    if (view.lock === 'keep' || view.lock === locked.current) return;
    const wanted = view.lock;
    locked.current = wanted;
    return lockWithRetry(orientationLock, logger, wanted, () => {
      // R26: forget it, so the next differing lock retries.
      if (locked.current === wanted) locked.current = null;
    });
  }, [view.lock, orientationLock, logger]);

  return view;
}

/** D26: one retry, half a second on, then forget as S0's R26 did. */
export const LOCK_RETRY_MS = 500;

/**
 * Locks; on a refusal logs it and tries once more. Returns the effect's
 * cleanup, which cancels a pending retry: a newer view supersedes it, and
 * that includes the on-air `keep`, which is no lock at all. A refused lock
 * whose retry never ran is not applied, so it is forgotten either way (R26),
 * or `keep` would leave it recorded as applied and deduped for good.
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
