import { createFetchMatchDayPort } from '@/services/fetchMatchDayPort';
import type { ScoringFetch } from '@/services/fetchScoringPort';
import type { Logger } from '@/services/logger';
import type { MatchDayPort } from '@/services/matchDayPort';

/**
 * The production Match Day port over plain `fetch` (AGENTS §8), which `createNativePorts` builds once. A code's token
 * goes only to the build's own host, `hosts[0]` (`seaznHosts` gives one; none trusts nothing), the rule the scoring
 * port keeps (`scoringPortFor`). Pure, so the wiring is tested.
 */
export function matchDayPortFor(deps: {
  readonly fetch: ScoringFetch;
  readonly logger: Logger;
  readonly hosts: readonly string[];
}): MatchDayPort {
  return createFetchMatchDayPort({
    fetch: deps.fetch,
    logger: deps.logger,
    host: deps.hosts[0] ?? '',
  });
}
