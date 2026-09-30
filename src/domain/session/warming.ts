export type WarmingGate = 'open' | 'passed' | 'unknown';

/**
 * Go live must happen before the descriptor's warming deadline — the web's
 * 10-minute no-signal timeout (spec §1). The instant itself counts as passed:
 * the server's timer has fired by then. Pure; the caller supplies the clock.
 */
export function warmingGate(deadline: Date | null, now: Date): WarmingGate {
  if (deadline === null) return 'unknown';
  return now.getTime() < deadline.getTime() ? 'open' : 'passed';
}
