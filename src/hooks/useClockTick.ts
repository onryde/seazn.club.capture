import { useEffect, useState } from 'react';
import { usePorts } from '@/hooks/usePorts';

/**
 * The phone clock, once a second while `active`. While not, it does not tick:
 * the clock is read once at mount and then not again until `active`. Only the
 * one leaf that shows a running time uses it — Elapsed — so nothing else
 * re-renders (AGENTS §8).
 */
export function useClockTick(active: boolean): number {
  const { clock } = usePorts();
  const [now, setNow] = useState(() => clock().getTime());
  useEffect(() => {
    if (!active) return;
    setNow(clock().getTime());
    const timer = setInterval(() => setNow(clock().getTime()), 1000);
    return () => clearInterval(timer);
  }, [active, clock]);
  return now;
}
