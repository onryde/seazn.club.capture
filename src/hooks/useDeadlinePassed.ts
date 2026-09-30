import { useEffect, useState } from 'react';
import { warmingGate } from '@/domain/session/warming';
import { usePorts } from '@/hooks/usePorts';

/**
 * Whether the warming deadline has passed, by the phone clock. One timer at
 * the deadline, so Go live disables itself even when nothing else changes
 * (Review Focus 4): no telemetry tick is needed to notice.
 */
export function useDeadlinePassed(deadlineMs: number | null): boolean {
  const { clock } = usePorts();
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const deadline = deadlineMs === null ? null : new Date(deadlineMs);
    const gate = warmingGate(deadline, clock());
    setPassed(gate === 'passed');
    if (gate !== 'open' || deadlineMs === null) return;
    const timer = setTimeout(() => setPassed(true), deadlineMs - clock().getTime());
    return () => clearTimeout(timer);
  }, [deadlineMs, clock]);
  return passed;
}
