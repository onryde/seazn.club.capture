import { useCallback, useLayoutEffect, useRef } from 'react';

/** A callback whose identity never changes, calling the latest `fn` given. */
export function useStableCallback(fn: () => void): () => void {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback(() => latest.current(), []);
}
