/**
 * Adds or replaces one query parameter, keeping every other parameter and any
 * fragment. String work rather than `URL`: Hermes' URL polyfill has lacked
 * parts of the API (S0's recognise note).
 */
export function withQueryParam(url: string, name: string, value: string): string {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);
  const encodedName = encodeURIComponent(name);
  const kept = query.split('&').filter((pair) => pair !== '' && pair.split('=')[0] !== encodedName);
  const added = `${encodedName}=${encodeURIComponent(value)}`;
  return `${path}?${[...kept, added].join('&')}${hash}`;
}

/**
 * AGENTS §7: the phone's preview runs with no delay, so the operator sees the
 * score slightly ahead of viewers. The Tier A route reads `?delay=` in ms
 * (seazn.club apps/web/src/app/overlay/fixtures/[fixtureId]/page.tsx:54-75,
 * `resolveDelayMs`); a broadcast delay already on the URL is replaced.
 */
export function overlayPreviewUrl(overlayUrl: string): string {
  return withQueryParam(overlayUrl, 'delay', '0');
}

/**
 * Cloudflare's own-player hint, in Mbps: the master playlist is restricted to
 * the rendition closest to it, so a peek on cellular costs little (D35).
 * Deliberately no `protocol=llhls`: it works only on low-latency inputs,
 * unconfirmed pending lane D (D36).
 */
export const PEEK_BANDWIDTH_MBPS = '1.0';

export function peekPlaybackUrl(playbackUrl: string): string {
  return withQueryParam(playbackUrl, 'clientBandwidthHint', PEEK_BANDWIDTH_MBPS);
}
