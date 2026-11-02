import { useCallback, useEffect, useState } from 'react';
import type { ModeCode } from '@/domain/mode/Mode';
import { asksBeforeOpening } from '@/domain/mode/otherMode';
import { rowsKey, type QueueRow } from '@/domain/mode/scoringHome';
import { selectEngineStatus } from '@/hooks/engineSelectors';
import { dismissMatch } from '@/hooks/scoringOpen';
import type { SaveFailed, SetStatusKey } from '@/hooks/useHome';
import { ignoreUnexpected, type SetPanel } from '@/hooks/useCodeCheck';
import { usePorts, type Ports } from '@/hooks/usePorts';
import type { ModeStore } from '@/services/modeStore';

/** While a live queue is sending, Home looks at the disk this often, so its count goes down as taps go. */
export const SCORING_POLL_MS = 2000;

const NO_ROWS: readonly QueueRow[] = [];

/**
 * The queues on the phone's disk, for Home's Remote Scoring cards (plan S2-1 Task 10; design §5): read when Home
 * mounts, on every return to the foreground and after Home changes one, and every `SCORING_POLL_MS` only while some queue
 * still has taps it can send (the background sender empties it, and the card should say so). A list that fails shows
 * the last cards (or none) and is recorded, never thrown. Home re-renders only when the cards would read differently.
 */
export function useScoringRows(): {
  readonly rows: readonly QueueRow[];
  readonly refresh: () => void;
} {
  const { tapQueue, foreground, logger } = usePorts();
  const [state, setState] = useState({ key: '', rows: NO_ROWS });
  const refresh = useCallback(() => {
    tapQueue.list().then(
      (rows) => {
        setState((prev) => (rowsKey(rows) === prev.key ? prev : { key: rowsKey(rows), rows }));
      },
      () => logger.warn('scoring.home-list-refused', {}),
    );
  }, [tapQueue, logger]);
  useEffect(() => {
    refresh();
    return foreground.subscribe(refresh);
  }, [refresh, foreground]);
  const sending = state.rows.some(
    (row) => row.kind === 'queue' && row.queue.pending.length > 0 && row.queue.dead === null,
  );
  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(refresh, SCORING_POLL_MS);
    return () => clearInterval(timer);
  }, [sending, refresh]);
  return { rows: state.rows, refresh };
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
type AtStake = { readonly label: string; readonly unsent: number | null };

/**
 * Read from the disk as the question is asked, not from what Home last drew: a sender may have emptied the queue
 * since. Nothing at stake is null (nothing to ask about). A disk that cannot be listed is asked about in the
 * unreadable words, since what is there cannot be said.
 */
async function atStake(ports: Pick<Ports, 'tapQueue'>, fixtureId: string): Promise<AtStake | null> {
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
