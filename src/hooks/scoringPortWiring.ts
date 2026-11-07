import { createFetchScoringPort, type ScoringFetch } from '@/services/fetchScoringPort';
import type { Logger } from '@/services/logger';
import type { ScoringPort } from '@/services/scoringPort';
import type { ServerClock } from '@/services/serverClock';

/**
 * The production scoring port over plain `fetch` (AGENTS §8), which `createNativePorts` builds once. A link's token
 * goes only to the build's own host, `hosts[0]` (`seaznHosts` gives one; none trusts nothing), the rule
 * `createRecordUploadPort` keeps for the upload credential. Every answer's `Date` header feeds `serverClock`, the
 * ports' own (S2-5 design §7.2). Pure, so the wiring is tested, like `scoringLinkPortFor`.
 */
export function scoringPortFor(deps: {
  readonly fetch: ScoringFetch;
  readonly logger: Logger;
  readonly hosts: readonly string[];
  readonly serverClock: ServerClock;
}): ScoringPort {
  return createFetchScoringPort({
    fetch: deps.fetch,
    logger: deps.logger,
    host: deps.hosts[0] ?? '',
    serverTime: (sampleMs) => deps.serverClock.sample(sampleMs),
  });
}
