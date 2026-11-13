import { useCallback, useEffect, useState } from 'react';

/**
 * A pull to refresh the operator started (review M4 of MD-2 Task 4): its spinner shows while the read it asked for, or
 * the one already out, is out, and goes when that read lands. A poll's read shows no spinner: nobody pulled. A pull
 * that starts no read (none can go) ends at once.
 */
export function usePullRefresh(
  refresh: () => void,
  reading: boolean,
): { readonly refreshing: boolean; readonly onRefresh: () => void } {
  const [pulled, setPulled] = useState(false);
  useEffect(() => {
    if (!reading) setPulled(false);
  }, [reading, pulled]);
  const onRefresh = useCallback(() => {
    setPulled(true);
    refresh();
  }, [refresh]);
  return { refreshing: pulled && reading, onRefresh };
}
