import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { type Result, err } from '@/domain/Result';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { ModeCode } from '@/domain/mode/Mode';
import type { HomePanel, StreamCode } from '@/hooks/useHome';
import { usePorts } from '@/hooks/usePorts';
import type { DescriptorPort } from '@/services/descriptorPort';
import type { Logger } from '@/services/logger';
import type { ModeStore } from '@/services/modeStore';

export type SetPanel = Dispatch<SetStateAction<HomePanel | null>>;
export type OpenCode = (code: ModeCode, descriptor: SessionDescriptor | null) => Promise<void>;
export type OpenOrCheck = (code: ModeCode) => Promise<void>;
type Answer = Result<SessionDescriptor, DescriptorError>;

const NO_ANSWER: Answer = err({ kind: 'offline' });
const CHECKING: HomePanel = { kind: 'checking', tapped: 'stream' };

/**
 * Ruling R12: the store takes writes only once it is `ready`. Read at call
 * time, not from a render, so a tap never acts on a stale snapshot.
 */
export function isReady(store: ModeStore): boolean {
  return store.getSnapshot().status === 'ready';
}

/**
 * A throw that is not a refused write is a bug (in navigation, say). Nothing
 * true can be said about it, so Home stays as it was, still usable, and no
 * rejection escapes. Refused writes never land here: they say so (R19).
 */
export function ignoreUnexpected(): void {}

/**
 * Home's scan-check flow (spec §1, D5, D27): a stream code checked with the
 * server before it is saved, Try again, and the one automatic retry on a busy
 * answer. Moved out of useHome as it was (carry 15).
 */
export function useDescriptorCheck(
  openCode: OpenCode,
  panel: HomePanel | null,
  setPanel: SetPanel,
): { readonly openOrCheck: OpenOrCheck; readonly retryCheck: () => void } {
  const openOrCheck = useOpenOrCheck(openCode, setPanel);
  const retryCheck = useRetryCheck(panel, openOrCheck);
  useBusyRetry(panel, retryCheck);
  return { openOrCheck, retryCheck };
}

/**
 * Spec §1: a stream code is checked with the server before anything is saved.
 * The scan flight is still up while this runs, so a second tap is ignored
 * until the answer is in. A store that is not ready is not asked (R12), nor is
 * a code that ran out while its panel sat open (a Try again), and a port that
 * throws or rejects is read as no connection.
 */
function useOpenOrCheck(openCode: OpenCode, setPanel: SetPanel): OpenOrCheck {
  const { descriptor, modeStore, logger, clock } = usePorts();
  return useCallback(
    async (code: ModeCode) => {
      if (code.mode !== 'stream') return openCode(code, null);
      if (!isReady(modeStore)) return;
      if (code.expiresAt.getTime() <= clock().getTime()) {
        return setPanel({ kind: 'expired', tapped: 'stream', mode: 'stream', at: code.expiresAt });
      }
      setPanel(CHECKING);
      const answer = await askSafely(descriptor, code, logger);
      if (!answer.ok) {
        return setPanel({ kind: 'descriptorError', tapped: 'stream', error: answer.error, code });
      }
      setPanel(null);
      await openCode(code, answer.value);
    },
    [descriptor, modeStore, logger, clock, openCode, setPanel],
  );
}

/**
 * A port that throws, synchronously or by rejecting, is no connection: the
 * panel always settles, never "Checking code…" for good (a missing module).
 * The fetch port logs its own refusals; a throw is recorded here, so it is
 * never silent either (spec §5). The token is never a field.
 */
async function askSafely(
  descriptor: DescriptorPort,
  code: StreamCode,
  logger: Logger,
): Promise<Answer> {
  try {
    return await descriptor.fetch(code.sid, code.token);
  } catch {
    logger.warn('descriptor.error', { kind: 'offline', status: 0, problem: 'port-threw' });
    return NO_ANSWER;
  }
}

/**
 * Try again (offline) and the busy retry (D5): the same code, under a scan
 * flight of its own so a tile tap cannot interleave, and a second press
 * before the first is answered asks nothing more.
 */
function useRetryCheck(panel: HomePanel | null, openOrCheck: OpenOrCheck): () => void {
  const { scanFlight } = usePorts();
  return useCallback(() => {
    if (panel?.kind !== 'descriptorError') return;
    if (!scanFlight.begin()) return;
    void openOrCheck(panel.code)
      .catch(ignoreUnexpected)
      .finally(() => scanFlight.end());
  }, [panel, openOrCheck, scanFlight]);
}

/** D5: one automatic retry per 429 answer, cancelled if the panel changes first. */
function useBusyRetry(panel: HomePanel | null, retry: () => void): void {
  useEffect(() => {
    if (panel?.kind !== 'descriptorError' || panel.error.kind !== 'rate-limited') return;
    const timer = setTimeout(retry, panel.error.retryAfterS * 1000);
    return () => clearTimeout(timer);
  }, [panel, retry]);
}
