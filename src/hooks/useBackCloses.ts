import { useEffect } from 'react';
import { usePorts } from '@/hooks/usePorts';

/**
 * Android Back closes what is open on top, as Android apps do, instead of
 * leaving the app (R31). Subscribed only while `open`, so with nothing open
 * Back falls through to the phone. Back calls the newest subscriber first, so
 * the last thing opened closes first. `close` should be stable (useCallback),
 * or every render re-subscribes.
 */
export function useBackCloses(open: boolean, close: () => void): void {
  const { back } = usePorts();
  useEffect(() => {
    if (!open) return;
    return back.subscribe(() => {
      close();
      return true;
    });
  }, [back, open, close]);
}
