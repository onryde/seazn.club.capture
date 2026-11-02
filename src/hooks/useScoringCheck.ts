import { useCallback, useRef } from 'react';
import type { ModeCode } from '@/domain/mode/Mode';
import { matchLabelOf } from '@/domain/scoring/matchLabel';
import { scanErrorOf } from '@/domain/scoring/scanFailure';
import type { ReadFailure } from '@/domain/scoring/wire';
import { linkOf, stuckOnLink } from '@/hooks/scoringOpen';
import type { OpenCode, SetPanel } from '@/hooks/useCodeCheck';
import type { HomePanel } from '@/hooks/useHome';
import { usePorts } from '@/hooks/usePorts';
import type { Logger } from '@/services/logger';
import type { ScoringLink, ScoringPort } from '@/services/scoringPort';

export type ScoringCode = Extract<ModeCode, { mode: 'scoring' }>;

const CHECKING: HomePanel = { kind: 'checking', tapped: 'scoring' };
const NO_ANSWER: ReadFailure = { kind: 'offline' };

/**
 * Home's scoring scan (plan S2-1 Task 10; design §4 step 1): a link is read from the server before anything is saved,
 * so a link that does not work never lands in the store and the match's id, which keys the link and the queue, is the
 * server's. The failure shows on the stream check's panel (`scanErrorOf`); offline there is nothing to save under.
 * One check at a time: a second call while one is in flight (a double tap on Open, Try again over a retry) asks and
 * saves nothing more, and the guard lets go on every way out, a throw included. A store that is not ready is not asked
 * (R12). The fetch port protects the token before it asks (`fetchScoringPort`), so it is never in a log line.
 */
export function useScoringCheck(
  openCode: OpenCode,
  setPanel: SetPanel,
): (code: ScoringCode) => Promise<void> {
  const ports = usePorts();
  const { modeStore, scoring, logger } = ports;
  const checking = useRef(false);
  return useCallback(
    async (code: ScoringCode) => {
      if (modeStore.getSnapshot().status !== 'ready' || checking.current) return;
      checking.current = true;
      try {
        setPanel(CHECKING);
        const answer = await bootstrapSafely(scoring, linkOf(ports, code.token), logger);
        if (answer.kind !== 'ok') {
          const dismiss = answer.kind === 'linkDead' ? await stuckOnLink(ports, code.token) : null;
          return setPanel({
            kind: 'codeError',
            tapped: 'scoring',
            error: scanErrorOf(answer),
            code,
            ...(dismiss === null ? {} : { dismiss }),
          });
        }
        setPanel(null);
        const { bootstrap } = answer;
        await openCode(code, null, {
          fixtureId: bootstrap.fixtureId,
          label: matchLabelOf(bootstrap),
        });
      } finally {
        checking.current = false;
      }
    },
    [ports, modeStore, scoring, logger, openCode, setPanel],
  );
}

/** A port that throws, or rejects, is no connection: the panel always settles. Recorded, never with the token. */
async function bootstrapSafely(port: ScoringPort, link: ScoringLink, logger: Logger) {
  try {
    return await port.bootstrap(link);
  } catch {
    logger.warn('scoring.scan', { problem: 'port-threw' });
    return NO_ANSWER;
  }
}
