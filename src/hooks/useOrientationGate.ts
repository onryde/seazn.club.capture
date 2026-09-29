import { useEffect, useRef, useState } from 'react';
import {
  INITIAL_TRACKER,
  orientationGate,
  track,
  type GateView,
  type Physical,
  type Target,
} from '@/domain/orientation/orientation';
import { usePorts } from '@/hooks/usePorts';

/** Live Stream is the only landscape mode (decision record ruling 4). */
export function routeTarget(pathname: string): Target {
  return pathname === '/stream' || pathname.startsWith('/stream/') ? 'landscape' : 'portrait';
}

/**
 * The one orientation controller (spec §5), mounted in the root layout. Reads
 * how the phone is held from the accelerometer, keeps the current lock while
 * the phone disagrees with the target (so the turn card reads upright in the
 * operator's hands), and locks once they agree. React state changes only when
 * the settled reading does, never per sample.
 */
export function useOrientationGate(target: Target): GateView {
  const physical = usePhysicalOrientation();
  const view = orientationGate(target, physical);
  const { orientationLock } = usePorts();
  const locked = useRef<Target | null>(null);

  useEffect(() => {
    if (view.lock === 'keep' || view.lock === locked.current) return;
    locked.current = view.lock;
    void orientationLock.lock(view.lock);
  }, [view.lock, orientationLock]);

  return view;
}

function usePhysicalOrientation(): Physical {
  const { motion } = usePorts();
  const [physical, setPhysical] = useState<Physical>('unknown');

  useEffect(() => {
    let tracker = INITIAL_TRACKER;
    let unsubscribe: (() => void) | null = null;
    let alive = true;
    void motion.isAvailable().then((available) => {
      if (!alive) return;
      // No accelerometer: never block the operator behind a card (spec §5).
      if (!available) return setPhysical('flat');
      unsubscribe = motion.subscribe((g, atMs) => {
        tracker = track(tracker, g, atMs);
        setPhysical(tracker.settled);
      });
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [motion]);

  return physical;
}
