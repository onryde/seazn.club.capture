import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { type Result, err } from '@/domain/Result';
import type { CodeError, WaitingFields } from '@/domain/credentials/waitingFields';
import type { ModeCode } from '@/domain/mode/Mode';
import type { SavedStream } from '@/domain/mode/savedCode';
import type { HomePanel, StreamCode } from '@/hooks/useHome';
import { usePorts } from '@/hooks/usePorts';
import type { CodePort } from '@/services/codePort';
import type { Logger } from '@/services/logger';
import type { ModeStore } from '@/services/modeStore';

export type SetPanel = Dispatch<SetStateAction<HomePanel | null>>;
export type OpenCode = (code: ModeCode, stream: SavedStream | null) => Promise<void>;
export type OpenOrCheck = (code: ModeCode) => Promise<void>;
type Answer = Result<WaitingFields, CodeError>;

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
export function useCodeCheck(
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
 * a code that ran out while its panel sat open (a Try again; a code with no
 * `exp` never runs out, A1), and a port that throws or rejects is read as no
 * connection. The token is protected before the ask (CD6, "from the scan").
 */
function useOpenOrCheck(openCode: OpenCode, setPanel: SetPanel): OpenOrCheck {
  const { code: port, modeStore, logger, clock } = usePorts();
  return useCallback(
    async (code: ModeCode) => {
      if (code.mode !== 'stream') return openCode(code, null);
      if (!isReady(modeStore)) return;
      if (code.expiresAt !== null && code.expiresAt.getTime() <= clock().getTime()) {
        return setPanel({ kind: 'expired', tapped: 'stream', mode: 'stream', at: code.expiresAt });
      }
      logger.protect({ secrets: [code.token], streamIds: [] });
      setPanel(CHECKING);
      const answer = await askSafely(port, code, logger);
      if (!answer.ok) {
        return setPanel({ kind: 'codeError', tapped: 'stream', error: answer.error, code });
      }
      setPanel(null);
      await openCode(code, {
        waiting: answer.value,
        codeUrl: port.codeUrl(code.code),
        tapToPair: false,
      });
    },
    [port, modeStore, logger, clock, openCode, setPanel],
  );
}

/**
 * A port that throws, synchronously or by rejecting, is no connection: the
 * panel always settles, never "Checking code…" for good (a missing module).
 * The fetch port logs its own refusals; a throw is recorded here, so it is
 * never silent either (spec §5). The token is never a field.
 */
async function askSafely(port: CodePort, code: StreamCode, logger: Logger): Promise<Answer> {
  try {
    return await port.check(code);
  } catch {
    logger.warn('code.error', { kind: 'offline', status: 0, problem: 'port-threw' });
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
    if (panel?.kind !== 'codeError') return;
    if (!scanFlight.begin()) return;
    void openOrCheck(panel.code)
      .catch(ignoreUnexpected)
      .finally(() => scanFlight.end());
  }, [panel, openOrCheck, scanFlight]);
}

/** D5: one automatic retry per 429 answer, cancelled if the panel changes first. */
function useBusyRetry(panel: HomePanel | null, retry: () => void): void {
  useEffect(() => {
    if (panel?.kind !== 'codeError' || panel.error.kind !== 'rate-limited') return;
    const timer = setTimeout(retry, panel.error.retryAfterS * 1000);
    return () => clearTimeout(timer);
  }, [panel, retry]);
}
