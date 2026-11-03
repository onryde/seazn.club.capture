import { useEffect } from 'react';
import { holdScreenOn } from '@/hooks/keepAwake';
import { usePorts } from '@/hooks/usePorts';

const TAG = 'seazn-capture-pad';

/**
 * Holds the screen on for as long as the caller is mounted: the scoring pad (owner rulings, 2026-10-31), so a scorer
 * between rallies never finds it locked. It never dims and never touches the brightness: the pad is read from the side
 * of a court, and Live Stream's idle dim (D2 §4.5) is Live Stream's alone. `holdScreenOn` says how.
 */
export function useScreenAwake(): void {
  const { logger } = usePorts();
  useEffect(() => holdScreenOn(TAG, 'scoring', logger), [logger]);
}
