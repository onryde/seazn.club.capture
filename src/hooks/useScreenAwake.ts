import { useEffect } from 'react';

const TAG = 'seazn-capture-pad';

/**
 * Holds the screen on for as long as the caller is mounted: the scoring pad (owner rulings, 2026-10-31), so a scorer
 * between rallies never finds it locked. It never dims and never touches the brightness: the pad is read from the side
 * of a court, and Live Stream's idle dim (D2 §4.5) is Live Stream's alone.
 *
 * Its own tag, so it never lets go of a hold Live Stream's `useKeepAwake` took. The module is loaded dynamically, as
 * there, so a missing native module degrades to "the screen may dim" rather than taking the app down at import.
 */
export function useScreenAwake(): void {
  useEffect(() => {
    let cancelled = false;
    void import('expo-keep-awake')
      .then((module) => (cancelled ? undefined : module.activateKeepAwakeAsync(TAG)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void import('expo-keep-awake')
        .then((module) => module.deactivateKeepAwake(TAG))
        .catch(() => undefined);
    };
  }, []);
}
