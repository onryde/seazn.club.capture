import { isBuildOrigin } from '@/services/seaznHosts';
import type { ScoringLink } from '@/services/scoringPort';

/**
 * Where the update banner's "Score in the browser" goes (owner ruling 8): the web's own scoring page for this link, on
 * the build's own host, or none. A link for another origin, a build with no host and no link at all are no target, so
 * the token is never put in a URL for anywhere else.
 */
export function browserTarget(host: string, link: ScoringLink | null): string | null {
  if (link === null || !isBuildOrigin(link.origin, host)) return null;
  return `https://${host}/score/${link.token}`;
}
