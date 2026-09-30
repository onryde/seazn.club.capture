/**
 * The hosts whose links count as Seazn (spec §2). Exact names, never a suffix.
 * Production only on an explicit `EXPO_PUBLIC_SEAZN_ENV=production`: a build
 * that forgets the variable reads staging codes, which fails safe — a club's
 * real codes are refused rather than a staging code being trusted in a
 * release.
 */
export function seaznHosts(env: string | undefined): readonly string[] {
  return env === 'production' ? ['seazn.club'] : ['stg.seazn.club'];
}

/** Where the descriptor lives (D2): the same production/staging split as the hosts, and the same safe default. */
export function descriptorOrigin(env: string | undefined): string {
  return env === 'production' ? 'https://seazn.club' : 'https://stg.seazn.club';
}

/**
 * The host of an https URL, lower-cased, with any port dropped. The host group
 * excludes `@` and `:`, so userinfo (`https://seazn.club@evil.example`) never
 * matches. Regex rather than `URL`: Hermes' URL polyfill has lacked `hostname`.
 */
const HTTPS_HOST = /^https:\/\/([^/?#@:\s]+)(?::\d+)?(?:[/?#]|$)/i;

/**
 * Whether a URL the server handed over points at Seazn (ruling 6): one of
 * `hosts` exactly, or a proper subdomain of one. Never a substring:
 * `evilseazn.club` and `seazn.club.evil.example` are foreign.
 */
export function isSeaznUrl(url: string, hosts: readonly string[]): boolean {
  const host = HTTPS_HOST.exec(url)?.[1]?.toLowerCase();
  if (host === undefined) return false;
  return hosts.some((seazn) => host === seazn || host.endsWith(`.${seazn}`));
}
