import { useEffect, useState } from 'react';
import { warmingGate } from '@/domain/session/warming';
import { usePorts } from '@/hooks/usePorts';

/**
 * Whether the warming deadline has passed, by the phone clock. One timer at
 * the deadline, so Go live disables itself even when nothing else changes
 * (Review Focus 4): no telemetry tick is needed to notice.
 *
 * M8: Android pauses JS timers while the app is away and counts them on a
 * clock that stops in deep sleep, so a phone locked across the deadline comes
 * back before its timer fires. Every return to the foreground re-reads the
 * clock, so the safety gate never fails open.
 */
export function useDeadlinePassed(deadlineMs: number | null): boolean {
  const { clock, foreground } = usePorts();
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const deadline = deadlineMs === null ? null : new Date(deadlineMs);
    const gate = warmingGate(deadline, clock());
    setPassed(gate === 'passed');
    const unsubscribe = foreground.subscribe(() =>
      setPassed(warmingGate(deadline, clock()) === 'passed'),
    );
    if (gate !== 'open' || deadline === null) return unsubscribe;
    const timer = setTimeout(() => setPassed(true), deadline.getTime() - clock().getTime());
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [deadlineMs, clock, foreground]);
  return passed;
}
