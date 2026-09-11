import type {
  SessionCredentials,
  StreamCredentials,
  Transport,
} from '@/domain/credentials/StreamCredentials';

/**
 * SRT primary, RTMPS automatic fallback — expressed as data rather than a
 * branch buried in a reconnect handler (AGENTS.md §4).
 *
 * SRT buys loss recovery on a cellular uplink at a wet ground, which is where
 * drops actually come from. RTMPS exists because some venue wifi and corporate
 * networks drop UDP, making SRT-only fragile in exactly the places clubs stream
 * from. Neither is a preference; both are needed, which is why C1 requires both
 * credential sets in hand at scan time.
 */
export function nextTransport(
  credentials: SessionCredentials,
  failed: readonly Transport[],
): StreamCredentials | null {
  const ladder = [credentials.primary, credentials.fallback];
  return ladder.find((candidate) => !failed.includes(candidate.transport)) ?? null;
}

/** Every rung tried. Native stops retrying and the session ends. */
export function isExhausted(
  credentials: SessionCredentials,
  failed: readonly Transport[],
): boolean {
  return nextTransport(credentials, failed) === null;
}
