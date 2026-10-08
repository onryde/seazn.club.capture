import type { CaptureEngineNative } from '@/engine/nativeModule';
import type { Logger } from '@/services/logger';
import { createScoringLinkPort, type ScoringLinkPort } from '@/services/scoringLinkPort';

/**
 * Spec §10: the production scoring-link port over the native module `createNativePorts` loaded once. No module
 * (iOS in S1, web) is a port that says unavailable; a stale build whose module has no `scoringLink` throws inside
 * the port, which says unavailable too. The call is a closure over the module, so native's `this` stays bound. The
 * link's secret is protected through the logger before the caller has the answer (a bucket of its own), and the
 * host the port trusts is the build's own, `hosts[0]` (`seaznHosts` gives one; none trusts nothing). Pure, so the
 * wiring is tested, like `photoPortFor`.
 */
export function scoringLinkPortFor(
  native: Pick<CaptureEngineNative, 'scoringLink'> | null,
  deps: { readonly logger: Pick<Logger, 'protectLink'>; readonly hosts: readonly string[] },
): ScoringLinkPort {
  return createScoringLinkPort(native === null ? null : () => native.scoringLink(), {
    protect: (secret) => deps.logger.protectLink(secret),
    host: deps.hosts[0] ?? '',
  });
}
