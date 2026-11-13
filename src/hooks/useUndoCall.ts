import { useCallback, useMemo, useRef, useState } from 'react';
import { refusalMeaning } from '@/domain/matchday/callCopy';
import type { Row } from '@/domain/matchday/matchDay';
import { heldCode } from '@/hooks/useApproval';
import { outcomeOf } from '@/hooks/useCallCourt';
import { leaveDay } from '@/hooks/useMatchDay';
import { refusalVerdict } from '@/hooks/useMatchDayHome';
import { usePorts, type Ports } from '@/hooks/usePorts';
import type { MessageKey } from '@/i18n/messages';
import type { CallAnswer } from '@/services/matchDayPort';

/** The called match the confirm sheet is about, and the court it is on. */
export type Undoing = { readonly row: Row; readonly courtName: string };

/** What the list does with the answer: one line on it (null clears the last), or read the day again. */
export type UndoSink = {
  readonly say: (line: MessageKey | null) => void;
  readonly refresh: () => void;
  /** The sheet has closed after an answer: the list opens its bounce window, as every other sheet's close does. */
  readonly settled?: () => void;
};

export type UndoView = {
  /** The match whose call is being asked about; null while no sheet shows. */
  readonly asking: Undoing | null;
  /** The call is out: one at a time. */
  readonly busy: boolean;
  /** A tap on Undo call: the sheet asks; a tap while one is asked or out does nothing. */
  readonly ask: (row: Row, courtName: string) => void;
  /** Keep: the sheet closes, nothing is sent. */
  readonly keep: () => void;
  /** Undo call: ONE request, however often it is tapped. */
  readonly undo: () => void;
};

/**
 * Undo a call from a called court's Now row (S4 design §7a): a confirm sheet, then one DELETE, with no hold ("a call
 * can be made again"). The answer closes the sheet; a refusal (started, not called, the desk's own call, no power, out
 * of scope, a paused competition) is said on the list in its words and the day is read again, as is a match that is gone
 * and an offline answer, which may still have landed. A code that has ended keeps the day's own handling. The record
 * gets `matchday.uncall {result}`, never a name or a match.
 */
export function useUndoCall(sink: UndoSink): UndoView {
  const ports = usePorts();
  const [asking, setAsking] = useState<Undoing | null>(null);
  const [busy, setBusy] = useState(false);
  const flying = useRef(false);
  const target = useRef<Undoing | null>(null);
  const { say, refresh, settled } = sink;
  const ask = useCallback((row: Row, courtName: string) => {
    if (target.current !== null) return;
    target.current = { row, courtName };
    setAsking(target.current);
  }, []);
  const keep = useCallback(() => {
    if (flying.current) return;
    target.current = null;
    setAsking(null);
  }, []);
  const undo = useCallback(() => {
    const now = target.current;
    if (now === null || flying.current) return;
    flying.current = true;
    setBusy(true);
    void undoOnce(ports, now, { say, refresh })
      .catch(() => {
        ports.logger.warn('matchday.uncall-failed');
        say('matchday.offlineEmpty');
        refresh();
      })
      .finally(() => {
        flying.current = false;
        target.current = null;
        setBusy(false);
        setAsking(null);
        settled?.();
      });
  }, [ports, say, refresh, settled]);
  return useMemo(() => ({ asking, busy, ask, keep, undo }), [asking, busy, ask, keep, undo]);
}

const OFFLINE = { ok: false, offline: true } as const;

async function undoOnce(ports: Ports, now: Undoing, sink: UndoSink): Promise<void> {
  sink.say(null);
  const held = heldCode(ports);
  if (held === null) return sink.say('matchday.cantOpen');
  let answer: CallAnswer<unknown>;
  try {
    answer = await ports.matchDay.undoCall(held.code, now.row.fixtureId);
  } catch {
    ports.logger.warn('matchday.call-threw');
    answer = OFFLINE;
  }
  ports.logger.info('matchday.uncall', { result: outcomeOf(answer) });
  // Called or not, offline or refused: the day is read again, since the call may have landed or moved.
  sink.refresh();
  if (answer.ok) return;
  if ('offline' in answer) return sink.say('matchday.offlineEmpty');
  if ('gone' in answer) return sink.say('matchday.call.moved');
  const meaning = refusalMeaning(answer.refused, 'undo', now.courtName);
  if (meaning !== 'leave') return sink.say(meaning.key);
  const { refused } = answer;
  const verdict = refusalVerdict({
    ok: false,
    refusal: refused.code as 'MD_UNKNOWN' | 'MD_WITHDRAWN' | 'MD_ENDED' | 'MD_NOT_OPEN',
    ...('opensAt' in refused && refused.opensAt !== undefined ? { opensAt: refused.opensAt } : {}),
  });
  if (verdict.kind === 'stop' || verdict.kind === 'notYet') {
    void leaveDay(ports, held.saved, verdict).catch(() =>
      ports.logger.warn('matchday.leave-failed'),
    );
  }
}
