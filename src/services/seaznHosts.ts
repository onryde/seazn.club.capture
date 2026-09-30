import { httpsHost } from '@/domain/credentials/wire';

/**
 * The one host whose links count as Seazn (spec §2), matched exactly: never a
 * subdomain, never a suffix. Production only on an explicit
 * `EXPO_PUBLIC_SEAZN_ENV=production`: a build that forgets the variable reads
 * staging codes, which fails safe — a club's real codes are refused rather
 * than a staging code being trusted in a release.
 */
export function seaznHosts(env: string | undefined): readonly string[] {
  return env === 'production' ? ['seazn.club'] : ['stg.seazn.club'];
}

/** Where the descriptor lives (D2): the same production/staging split as the hosts, and the same safe default. */
export function descriptorOrigin(env: string | undefined): string {
  return env === 'production' ? 'https://seazn.club' : 'https://stg.seazn.club';
}

/**
 * Whether a URL points at one of `hosts` exactly (ruling 6). Never a
 * subdomain (`api.stg.seazn.club`), never a substring (`evilseazn.club`,
 * `seazn.club.evil.example`), and never a URL a browser would send elsewhere
 * (userinfo, a backslash): see `httpsHost`.
 */
export function isSeaznUrl(url: string, hosts: readonly string[]): boolean {
  const host = httpsHost(url);
  if (host === null) return false;
  return hosts.includes(host);
}
