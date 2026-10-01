/**
 * Ended's "Scan another" (D24): the viewfinder asks, Home scans. Only Home
 * calls `scan()` (S0), so a request is a flag Home takes once it is ready.
 * A flag, not a queue: asked twice before Home takes it, it scans once.
 */
export type HomeIntent = {
  requestScan(): void;
  /** True once per request; taking it clears it. */
  takeScan(): boolean;
};

export function createHomeIntent(): HomeIntent {
  let pending = false;
  return {
    requestScan: () => {
      pending = true;
    },
    takeScan: () => {
      const was = pending;
      pending = false;
      return was;
    },
  };
}
