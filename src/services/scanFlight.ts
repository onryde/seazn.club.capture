/**
 * Whether Home has sent the operator to the phone's scanner and not yet dealt
 * with what came back (I2). The scanner is Play services' own activity, so
 * going to it sends the app to the background and coming back is a return to
 * the foreground; the reopen gate asks this whether a return is the scan's, so
 * a scan's panel or open is never overtaken.
 *
 * Android delivers the scan result about 44 ms before the return (R36, on the
 * Redmi), so the flight covers the return as well as the scan: a scan that
 * ended while the app was still away stays up until the app is back, and that
 * return is the scan's. A scan that never left the app (no Play services, say)
 * ends at once. Order-independent, with no timer.
 *
 * A flag and one boolean, not a state: it holds nothing about the session,
 * which native owns (AGENTS §2). Built once, in the ports.
 */
export type ScanFlight = {
  /** Raises the flag. False, and nothing changes, when a flight is up. */
  begin(): boolean;
  /** The scan's result is dealt with. Lowers the flag unless the app is still away. */
  end(): void;
  /** The app left the foreground. Counts only during a scan. */
  appLeft(): void;
  /** The app is back. True when the return is the scan's; that lowers what it held. */
  appReturned(): boolean;
  active(): boolean;
};

export function createScanFlight(): ScanFlight {
  let scanning = false;
  let away = false;
  return {
    begin: () => {
      if (scanning || away) return false;
      scanning = true;
      return true;
    },
    end: () => {
      scanning = false;
    },
    appLeft: () => {
      if (scanning) away = true;
    },
    appReturned: () => {
      const ours = scanning || away;
      away = false;
      return ours;
    },
    active: () => scanning || away,
  };
}
