import { useEffect } from 'react';
import { scoringHubOf } from '@/hooks/scoringHub';
import { usePorts } from '@/hooks/usePorts';

/**
 * The background sender (plan S2-1 Task 9; owner ruling 29): taps left in a match's queue go on being sent while nobody
 * looks at that match. Mounted once, near the root (Task 10 mounts it): it looks for queued taps at launch and on every
 * return to the foreground, and the hub starts one sender per match that has any, which lets go when its queue is empty,
 * dead, or has no link. A match whose pad is on screen has its own runner and is left alone.
 */
export function useScoringBackground(): void {
  const ports = usePorts();
  useEffect(() => {
    const hub = scoringHubOf(ports);
    void hub.resume();
    return ports.foreground.subscribe(() => void hub.resume());
  }, [ports]);
}
