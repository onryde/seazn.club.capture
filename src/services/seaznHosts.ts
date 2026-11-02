import type { Environment } from '@/domain/session/Pairing';

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

/**
 * The origin exactly as the build's host makes it: no other scheme, port, path, userinfo or suffix. The one test a
 * scoring link's token passes before it goes anywhere (the fetch port, the link store, the browser), so it is spelled
 * once. A build with no host (`''`) trusts nothing.
 */
export const isBuildOrigin = (origin: string, host: string): boolean =>
  host !== '' && origin === `https://${host}`;

/** Where the phone API lives (D2, D3): the same production/staging split as the hosts, and the same safe default. */
export function seaznOrigin(env: string | undefined): string {
  return env === 'production' ? 'https://seazn.club' : 'https://stg.seazn.club';
}

/** CD36: the environment a pair names, which native holds its hosts to. The same safe default. */
export function seaznEnvironment(env: string | undefined): Environment {
  return env === 'production' ? 'production' : 'staging';
}
