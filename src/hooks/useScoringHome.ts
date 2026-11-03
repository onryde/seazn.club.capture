import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModeCode } from '@/domain/mode/Mode';
import { asksBeforeOpening } from '@/domain/mode/otherMode';
import { rowsKey, type MatchFinish, type QueueRow } from '@/domain/mode/scoringHome';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { readFinish } from '@/hooks/scoringFinish';
import { scoringHubOf } from '@/hooks/scoringHub';
import { dismissMatch } from '@/hooks/scoringOpen';
import type { SaveFailed, SetStatusKey } from '@/hooks/useHome';
import { ignoreUnexpected, type SetPanel } from '@/hooks/useCodeCheck';
import { usePorts, type Ports } from '@/hooks/usePorts';
import type { ModeStore } from '@/services/modeStore';

/** While a live queue is sending, Home looks at the disk this often, so its count goes down as taps go. */
export const SCORING_POLL_MS = 2000;

const NO_ROWS: readonly QueueRow[] = [];

/** What Home has read of the disk: the queues, and whether the saved match is over. */
type Read = {
  readonly key: string;
  readonly rows: readonly QueueRow[];
  readonly finish: MatchFinish | null;
};

const NOTHING_READ: Read = { key: '', rows: NO_ROWS, finish: null };

/** What would change a card: the queues' key, and the saved match's result (the score names it, so the id is the key's). */
const readKey = (rows: readonly QueueRow[], finish: MatchFinish | null): string =>
  `${rowsKey(rows)}\n#${finish === null ? '' : `${finish.fixtureId}|${finish.score}`}`;

/** Whether the saved match had taps unsent in the last read and has none in this one: the sender emptied it. */
function unsentGone(
  before: readonly QueueRow[],
  after: readonly QueueRow[],
  saved: string | null,
): boolean {
  return saved !== null && unsentOf(before, saved) > 0 && unsentOf(after, saved) === 0;
}

function unsentOf(rows: readonly QueueRow[], saved: string): number {
  const own = rows.find(
    (row) => (row.kind === 'queue' ? row.queue.fixtureId : row.fixtureId) === saved,
  );
  return own?.kind === 'queue' ? own.queue.pending.length : 0;
}

/**
 * The saved match's files, asked whether it is over, only when nothing of it is unsent: a match with taps still going
 * is Continue whatever its files say, and a queue that cannot be read is not asked about (its card says so). A read
 * that throws is recorded and is "not over", never a Finished card on a guess.
 */
async function finishOfSaved(
  ports: Pick<Ports, 'kv' | 'hosts' | 'tapQueue' | 'clock' | 'logger'>,
  saved: string | null,
  rows: readonly QueueRow[],
): Promise<MatchFinish | null> {
  if (saved === null) return null;
  const own = rows.find(
    (row) => (row.kind === 'queue' ? row.queue.fixtureId : row.fixtureId) === saved,
  );
  if (own !== undefined && (own.kind === 'unreadable' || own.queue.pending.length > 0)) return null;
  try {
    const finish = await readFinish(ports, saved);
    return finish === null ? null : { fixtureId: saved, score: finish.score };
  } catch {
    ports.logger.warn('scoring.home-finish-refused', {});
    return null;
  }
}

/**
 * The queues on the phone's disk, for Home's Remote Scoring cards (plan S2-1 Task 10; design §5), and whether the saved
 * match `savedId` is over (owner ruling 41, 2026-11-02). Both are read when Home mounts, on every return to the
 * foreground, after Home changes one, and when the saved match changes. Every `SCORING_POLL_MS`, only while some queue
 * still has taps it can send (the background sender empties it, and the card should say so), Home reads the LIST alone;
 * the saved match's files are read on the tick that sees its last unsent tap gone, and on no other. A pad just left may
 * still be writing the match's last ledger and boot cache, so Home reads both again once that runner has stopped
 * (`ScoringHub.settled`). A list that fails shows the last cards (or none) and is recorded, never thrown. Only the newest
 * read is kept: one begun earlier that lands later never puts back what a newer one took away. Home re-renders only
 * when the cards would read differently.
 */
export function useScoringRows(savedId: string | null = null): {
  readonly rows: readonly QueueRow[];
  readonly finish: MatchFinish | null;
  readonly refresh: () => void;
} {
  const ports = usePorts();
  const { tapQueue, foreground, logger } = ports;
  const [state, setState] = useState<Read>(NOTHING_READ);
  const newest = useRef(0);
  /** What the newest accepted read said: a list-only read keeps its answer about the saved match. */
  const held = useRef<Read>(NOTHING_READ);
  const read = useCallback(
    (listOnly: boolean) => {
      const mine = (newest.current += 1);
      tapQueue
        .list()
        .then(async (rows) => {
          const before = held.current;
          const keep = listOnly && !unsentGone(before.rows, rows, savedId);
          return { rows, finish: keep ? before.finish : await finishOfSaved(ports, savedId, rows) };
        })
        .then(
          ({ rows, finish }) => {
            if (mine !== newest.current) return;
            const key = readKey(rows, finish);
            if (key === held.current.key) return;
            held.current = { key, rows, finish };
            setState(held.current);
          },
          () => logger.warn('scoring.home-list-refused', {}),
        );
    },
    [tapQueue, ports, savedId, logger],
  );
  const refresh = useCallback(() => read(false), [read]);
  const tick = useCallback(() => read(true), [read]);
  useEffect(() => {
    refresh();
    let mounted = true;
    const again = (): void => {
      if (mounted) refresh();
    };
    const stopping = savedId === null ? null : scoringHubOf(ports).settled(savedId);
    stopping?.then(again, again);
    const off = foreground.subscribe(refresh);
    return () => {
      mounted = false;
      off();
    };
  }, [refresh, foreground, ports, savedId]);
  const sending = state.rows.some(
    (row) => row.kind === 'queue' && row.queue.pending.length > 0 && row.queue.dead === null,
  );
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(tick, SCORING_POLL_MS);
    return () => clearInterval(timer);
  }, [sending, tick]);
  return { rows: state.rows, finish: state.finish, refresh };
}

/**
 * Dismiss, from a bad-link panel or a card: the match goes with its link and files, and its code if it was the saved
 * match (`dismissMatch`). The panel goes at once. A refusal is never silent (R19): the status line says so.
 */
export function useDismissScoring(
  setPanel: SetPanel,
  saveFailed: SaveFailed,
  refresh: () => void,
): (fixtureId: string) => void {
  const ports = usePorts();
  return useCallback(
    (fixtureId: string) => {
      setPanel(null);
      dismissMatch(ports, fixtureId)
        .catch(() => saveFailed('forget'))
        .finally(refresh);
    },
    [ports, setPanel, saveFailed, refresh],
  );
}

/** What a Dismiss would delete: the match's name as the queue file has it, and its unsent taps (null: it cannot be read). */
export type AtStake = { readonly label: string; readonly unsent: number | null };

/**
 * Read from the disk as the question is asked, not from what Home last drew: a sender may have emptied the queue
 * since. Nothing at stake is null (nothing to ask about). A disk that cannot be listed is asked about in the
 * unreadable words, since what is there cannot be said.
 */
export async function atStake(
  ports: Pick<Ports, 'tapQueue'>,
  fixtureId: string,
): Promise<AtStake | null> {
  try {
    const row = (await ports.tapQueue.list()).find((entry) =>
      entry.kind === 'queue' ? entry.queue.fixtureId === fixtureId : entry.fixtureId === fixtureId,
    );
    if (row === undefined) return null;
    if (row.kind === 'unreadable') return { label: '', unsent: null };
    const unsent = row.queue.pending.length;
    return unsent === 0 ? null : { label: row.queue.label, unsent };
  } catch {
    return { label: '', unsent: null };
  }
}

/**
 * Dismiss that discards taps asks first (owner ruling B, 2026-11-02): one sheet names the match and the number of taps,
 * says they will not reach Seazn, and offers Dismiss and Keep. A queue with nothing in it is let go at once, since
 * nothing is lost. Asked from a card or from the bad-link panel; `dismiss` is what the sheet's Dismiss runs.
 */
export function useAskDismiss(
  setPanel: SetPanel,
  dismiss: (fixtureId: string) => void,
): (fixtureId: string) => void {
  const ports = usePorts();
  return useCallback(
    (fixtureId: string) => {
      void atStake(ports, fixtureId).then((stake) => {
        if (stake === null) return dismiss(fixtureId);
        setPanel({ kind: 'dismissConfirm', tapped: 'scoring', fixtureId, ...stake });
      });
    },
    [ports, setPanel, dismiss],
  );
}

/** A saved match's resume carries no scan: its link is already kept (with its sport), so there is no token to keep. */
const RESUME: ModeCode = { mode: 'scoring', raw: '', token: '' };

/**
 * Continue on the saved match: makes Remote Scoring the active mode and opens the pad, which reads the match from its
 * own files. While Live Stream holds a pairing it asks first (A7), as a scan of a scoring code does; Confirm opens the
 * match as `openCode` does, with `RESUME`, which keeps no link. A refused write is never silent (R19).
 */
export function useContinueScoring(
  setStatusKey: SetStatusKey,
  saveFailed: SaveFailed,
  setPanel: SetPanel,
): () => void {
  const { modeStore, navigation, engine } = usePorts();
  return useCallback(() => {
    const scoring = savedPart(modeStore);
    if (scoring === null) return;
    if (asksBeforeOpening('scoring', selectEngineStatus(engine.getSnapshot()))) {
      return setPanel({
        kind: 'unpairConfirm',
        tapped: 'scoring',
        code: RESUME,
        scoring: { kind: 'resume', match: scoring },
      });
    }
    void modeStore
      .setActive('scoring')
      .then(
        () => {
          setStatusKey(null);
          navigation.go('scoring');
        },
        () => saveFailed('continue'),
      )
      .catch(ignoreUnexpected);
  }, [modeStore, navigation, engine, setStatusKey, saveFailed, setPanel]);
}

function savedPart(store: ModeStore) {
  const snapshot = store.getSnapshot();
  return snapshot.status === 'ready' ? (snapshot.saved.codes.scoring?.scoring ?? null) : null;
}
