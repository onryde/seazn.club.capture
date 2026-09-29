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
import type { MotionPort } from '@/services/devicePorts';

/** Live Stream is the only landscape mode (decision record ruling 4). */
export function routeTarget(pathname: string): Target {
  return pathname === '/stream' || pathname.startsWith('/stream/') ? 'landscape' : 'portrait';
}

/**
 * The one orientation controller (spec §5), mounted in the root layout. Reads
 * how the phone is held from the accelerometer. While the phone disagrees with
 * the target it locks to the hands, so the turn card reads upright (R24),
 * unless the engine is on air, when the current lock stays. Locks to the target
 * once they agree, and before any reading has settled (R34). React state
 * changes only when the settled reading or the on-air status does, never per
 * sample or per telemetry tick.
 */
export function useOrientationGate(target: Target): GateView {
  const physical = usePhysicalOrientation();
  // Module-scope, primitive selector: a telemetry tick re-renders nothing (AGENTS §8).
  const onAir = useEngineSelector(selectHoldsOrientation);
  const view = orientationGate(target, physical, onAir);
  const { orientationLock } = usePorts();
  const locked = useRef<Target | null>(null);

  useEffect(() => {
    if (view.lock === 'keep' || view.lock === locked.current) return;
    const wanted = view.lock;
    locked.current = wanted;
    orientationLock.lock(wanted).catch(() => {
      // R26: forget it, so the next differing lock retries. Unlogged: the AGENTS §11 logger is S1.
      if (locked.current === wanted) locked.current = null;
    });
  }, [view.lock, orientationLock]);

  return view;
}

function usePhysicalOrientation(): Physical {
  const { motion } = usePorts();
  const [physical, setPhysical] = useState<Physical>('unknown');
  useEffect(() => watchPhysical(motion, setPhysical), [motion]);
  return physical;
}

/**
 * Feeds settled readings to `onSettled` and returns the unsubscribe. No
 * accelerometer reads as `flat`: never block the operator behind a card (spec §5).
 */
function watchPhysical(motion: MotionPort, onSettled: (physical: Physical) => void): () => void {
  let tracker = INITIAL_TRACKER;
  let unsubscribe: (() => void) | null = null;
  let alive = true;
  // R26: a failed check counts as no accelerometer. Unlogged: the AGENTS §11 logger is S1.
  const availability = motion.isAvailable().catch(() => false);
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
