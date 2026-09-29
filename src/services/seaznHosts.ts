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
