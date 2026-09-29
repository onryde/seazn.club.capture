/**
 * Whether Home has sent the operator to the phone's scanner and not yet dealt
 * with what came back (I2). The scanner is Play services' own activity, so
 * coming back from it is a return to the foreground; the reopen gate reads this
 * to leave that return alone, so a scan's panel or open is never overtaken.
 *
 * A flag Home raises for one scan, not a state: it holds nothing about the
 * session, which native owns (AGENTS §2). Built once, in the ports.
 */
export type ScanFlight = {
  /** Raises the flag. False, and nothing changes, when a scan is already in flight. */
  begin(): boolean;
  end(): void;
  active(): boolean;
};

export function createScanFlight(): ScanFlight {
  let inFlight = false;
  return {
    begin: () => {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    end: () => {
      inFlight = false;
    },
    active: () => inFlight,
  };
}
