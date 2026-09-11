/**
 * Display formatting. Kept out of `domain/` because it is a presentation
 * concern, and kept out of components so it can be tested without a renderer.
 */

/**
 * Elapsed broadcast time: `MM:SS`, growing to `H:MM:SS` past the hour.
 *
 * This deliberately does NOT pad to a constant `HH:MM:SS`. The control column
 * is 150px wide, which leaves about 118px of content. IBM Plex Mono advances
 * 0.6em per character, so eight characters cap the clock at roughly 24px —
 * and the clock is the number an operator reads fastest from a tripod at
 * arm's length. Dropping the leading hours buys 28px type for the first hour
 * of every match, at the cost of the field widening once, at 1:00:00. One
 * width change per match is a cheaper price than an hour of smaller type.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${pad(minutes)}:${pad(seconds)}`;
  return hours === 0 ? mmss : `${hours}:${mmss}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Whole kbps. Fractions of a kilobit are noise on a tripod at two metres. */
export function formatBitrate(kbps: number): string {
  return String(Math.max(0, Math.round(kbps)));
}

/** Round-trip time, or an em dash when there is no connection to measure. */
export function formatRtt(ms: number | null): string {
  return ms === null ? '—' : String(Math.round(ms));
}

export function formatTransport(transport: 'srt' | 'rtmps'): string {
  return transport === 'srt' ? 'SRT' : 'RTMPS';
}
