import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  ChessColour,
  ChessDisplay,
  ChessMethod,
  ChessPadKey,
  ChessRung,
  ChessTiebreakState,
} from '@/domain/scoring/chessTypes';
import { isBounce } from '@/domain/scoring/bounce';
import { chessMethodsFor, chessTakesResult } from '@/domain/scoring/chessPad';
import { tiebreakStale, type TiebreakDraft } from '@/domain/scoring/chessTiebreakSheet';
import { TAKEN, refusing, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadHistoryGroup, PadMatchDetails, PadSide } from '@/domain/scoring/padView';
import {
  askedView,
  staleByAsk,
  useJustShown,
  type AskFacts,
  type AskView,
  type Recording,
} from '@/hooks/usePadSheetParts';
import type { Arm } from '@/hooks/usePadTaps';
import { usePorts } from '@/hooks/usePorts';
import {
  tiebreakView,
  useShowTiebreak,
  useTiebreakActions,
  type ChessTiebreakDriver,
  type TiebreakView,
} from '@/hooks/useChessTiebreak';

/**
 * The sheets over the chess pad (plan S2-3 Task 3; spec §4; the Batch A review's rulings): the How sheet, which asks how a
 * game was won or drawn and records nothing until Record, the tie-break sheet of a drawn knockout game (S2-3b; its parts are
 * `useChessTiebreak`), then Match details, History, and the reconnect question over them all. Table tennis's twin is
 * `useTableTennisSheets`; what the sports share (the bounce window of a sheet appearing, the question) is
 * `usePadSheetParts`.
 */

/** What Record asks the match to do, and what it came to at once. */
export type ChessSheetDriver = ChessTiebreakDriver & {
  /** The seat that won (null: a draw) and the method chosen, if one was. */
  readonly result: (winner: PadSide | null, method: ChessMethod | null) => PadOutcome;
};

/** What the sheets are drawn from: the display, Match details and History as the pad has them, and the question over the pad. */
export type ChessSheetSnapshot = AskFacts & {
  readonly display: ChessDisplay;
  readonly details: PadMatchDetails<ChessPadKey>;
  readonly history: readonly PadHistoryGroup<ChessPadKey>[];
};

/**
 * What is over the pad. The How sheet holds the SEAT that won, never a colour (the Batch A review's ruling 1): a pairing
 * from another scorer must not change the player the scorer chose; with the method picked and the methods on offer, in the
 * engine's order.
 */
export type ChessSheetView =
  | {
      readonly kind: 'how';
      readonly winner: PadSide | null;
      readonly picked: ChessMethod | null;
      readonly methods: readonly ChessMethod[];
    }
  | TiebreakView
  | { readonly kind: 'details'; readonly details: PadMatchDetails<ChessPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<ChessPadKey>[] }
  | AskView;

/** The How sheet also remembers the colours it was opened under: it closes when they change (the Batch A review's ruling 3). */
type Sheet =
  | {
      readonly kind: 'how';
      readonly winner: PadSide | null;
      readonly picked: ChessMethod | null;
      readonly colour: ChessColour | null;
    }
  /** The tie-break sheet holds seats and rungs only, never a colour, so no ledger move but its own staleness closes it. */
  | { readonly kind: 'tiebreak'; readonly draft: TiebreakDraft }
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | null;

const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };

const NOT_NOW: PadOutcome = refusing('notNow');

/** The name a sheet's close has in the bounce memory. */
const CLOSE_TAP = 'close';

/**
 * The sheet over the chess pad: a half or Draw shows How (`show`), a pick chooses a method or none, Record sends the result
 * and leaves, Cancel, the dim and Back close it with nothing sent. A pick or Record takes no tap in the bounce window of
 * the sheet appearing (`justShown`): the second touch of a double tap on a half lands on the sheet, on the same edge.
 * `record` is the bounce memory's (`useTaps`' `opening`): Record leaves the sheet with it, so a double tap counts once.
 * `arm` is its `arm`: every close by touch (`dismiss`) opens the same window without making a tap, so the second touch
 * cannot reach the tool under the button and the line is left as it was.
 */
export function useChessSheets(
  pad: ChessSheetDriver,
  snapshot: ChessSheetSnapshot | null,
  record: Recording,
  arm: Arm,
) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const view = useMemo(() => sheetView(sheet, snapshot), [sheet, snapshot]);
  const justShown = useJustShown(guardedStep(view));
  const show = useShow(snapshot, setSheet);
  const setDraft = useCallback((draft: TiebreakDraft) => setSheet({ kind: 'tiebreak', draft }), []);
  const showTiebreak = useShowTiebreak(tiebreakFacts(snapshot), setDraft);
  // No match to put a sheet over, the question over it, or nothing left for it to do: no sheet stays open behind it.
  if (sheet !== null && staleSheet(sheet, snapshot)) setSheet(null);
  const picks = useTiebreakActions({
    draft: sheet?.kind === 'tiebreak' ? sheet.draft : null,
    rungs: snapshot?.display.tiebreak.rungs ?? NO_RUNGS,
    setDraft,
    close: cancel,
    justShown,
    pad,
    record,
  });
  const actions = useActions({ sheet, setSheet, snapshot, justShown, pad, record, arm, cancel });
  return {
    open: sheet !== null,
    howOpen: sheet?.kind === 'how',
    tiebreakOpen: sheet?.kind === 'tiebreak',
    cancel,
    show,
    showTiebreak,
    actions: useMemo(() => ({ ...actions, ...picks }), [actions, picks]),
    view,
    justShown,
  };
}

const NO_RUNGS: readonly ChessRung[] = [];

/**
 * The tie-break state the sheet opens on, or none while there is no match under it or the reconnect question stands over the
 * pad (nothing is recorded until it is answered): the sheet is then not now.
 */
function tiebreakFacts(snapshot: ChessSheetSnapshot | null): ChessTiebreakState | null {
  if (snapshot === null || staleByAsk('tiebreak', snapshot)) return null;
  return snapshot.display.tiebreak;
}

type SetSheet = (sheet: Sheet) => void;

/** The How sheet for a seat (null: a draw), unless the game takes no result now or the question stands. */
function useShow(snapshot: ChessSheetSnapshot | null, setSheet: SetSheet) {
  return useCallback(
    (winner: PadSide | null): PadOutcome => {
      if (snapshot === null || staleByAsk('how', snapshot)) return NOT_NOW;
      if (!chessTakesResult(snapshot.display)) return NOT_NOW;
      setSheet({ kind: 'how', winner, picked: null, colour: snapshot.display.colorOfHome });
      return TAKEN;
    },
    [snapshot, setSheet],
  );
}

type Parts = {
  readonly sheet: Sheet;
  readonly setSheet: SetSheet;
  readonly snapshot: ChessSheetSnapshot | null;
  readonly justShown: () => boolean;
  readonly pad: ChessSheetDriver;
  readonly record: Recording;
  readonly arm: Arm;
  readonly cancel: () => void;
};

function useActions({ sheet, setSheet, snapshot, justShown, pad, record, arm, cancel }: Parts) {
  const details = useCallback(() => setSheet(DETAILS), [setSheet]);
  const history = useCallback(() => setSheet(HISTORY), [setSheet]);
  // A sheet's own close (Cancel, the dim, Details' close, Keep, History's close) leaves the screen with its touch, so it
  // arms the bounce window of an opening tap (`useTaps`): the second touch of a double tap lands on what was under it, a
  // half or a tool (Swap colours writes a pairing), and counts once with it. It is no tap, so it says nothing: an opening
  // tap clears the line, and a refusal shown before the sheet covered the pad would be wiped unseen. Back is not a touch
  // on the pad: `cancel` stays out of the memory.
  const dismiss = useCallback(() => {
    if (justShown()) return;
    arm(CLOSE_TAP);
    cancel();
  }, [justShown, arm, cancel]);
  const { picked, justPicked } = usePickedAt();
  const pickMethod = useCallback(
    (method: ChessMethod | null) => {
      if (sheet?.kind !== 'how' || justShown()) return;
      if (method !== null && !chessMethodsFor(sheet.winner).includes(method)) return;
      // A tap on the picked chip clears it; on the heels of the pick it is the second touch of a double tap, not a choice.
      if (method === null && justPicked()) return;
      if (method !== null) picked();
      setSheet({ ...sheet, picked: method });
    },
    [sheet, setSheet, justShown, justPicked, picked],
  );
  const recordResult = useCallback(() => {
    if (sheet?.kind !== 'how' || justShown()) return;
    setSheet(null);
    record('result', () => pad.result(sheet.winner, sheet.picked));
  }, [sheet, setSheet, justShown, record, pad]);
  // Discard asks again before it deletes: quiet in the bounce window of the question appearing.
  const askDiscard = useCallback(() => {
    if (snapshot !== null && !justShown()) setSheet(DISCARD);
  }, [snapshot, justShown, setSheet]);
  return useMemo(
    () => ({ details, history, pickMethod, record: recordResult, dismiss, askDiscard }),
    [details, history, pickMethod, recordResult, dismiss, askDiscard],
  );
}

/** When a method was last picked: a clear inside the bounce window of it is the same chip tapped twice (`pickMethod`). */
function usePickedAt() {
  const { clock } = usePorts();
  const at = useRef<number | null>(null);
  const picked = useCallback(() => {
    at.current = clock().getTime();
  }, [clock]);
  const justPicked = useCallback(
    () => at.current !== null && isBounce(clock().getTime() - at.current),
    [clock],
  );
  return { picked, justPicked };
}

/**
 * The step on screen a double tap can reach, by name: the How sheet, each step of the tie-break sheet (a pick moves it to the
 * next, whose choices lie on the same edge), Match details (whose dim takes the second touch on its icon), the question and
 * its confirm. Not History: its one button is not under its icon.
 */
function guardedStep(view: ChessSheetView | null): string | null {
  if (view?.kind === 'tiebreak') return `tiebreak.${view.step}`;
  return view === null || view.kind === 'history' ? null : view.kind;
}

/**
 * Whether an open sheet has no place now: the question's rules (`staleByAsk`), or what it was for is gone. The How sheet was
 * for a live game under the colours it was opened with: a result, a tie-break, the organiser's lock, an abandon, or a
 * pairing from anyone ends it. The tie-break sheet was for a tie-break still owed, of a rung the stage still plays.
 */
function staleSheet(sheet: NonNullable<Sheet>, snapshot: ChessSheetSnapshot | null): boolean {
  if (snapshot === null || staleByAsk(sheet.kind, snapshot)) return true;
  if (sheet.kind === 'tiebreak') return tiebreakStale(sheet.draft, snapshot.display.tiebreak);
  if (sheet.kind !== 'how') return false;
  return !chessTakesResult(snapshot.display) || snapshot.display.colorOfHome !== sheet.colour;
}

function sheetView(sheet: Sheet, snapshot: ChessSheetSnapshot | null): ChessSheetView | null {
  if (snapshot === null) return null;
  // The reconnect question stands over everything while it stands (nothing is sent until it is answered), and its
  // confirm over it, a card or none.
  const asked = askedView(sheet?.kind, snapshot);
  if (asked !== null) return asked;
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'how':
      return {
        kind: 'how',
        winner: sheet.winner,
        picked: sheet.picked,
        methods: chessMethodsFor(sheet.winner),
      };
    case 'tiebreak':
      return tiebreakView(sheet.draft, snapshot.display.tiebreak);
    case 'details':
      return { kind: 'details', details: snapshot.details };
    case 'history':
      return { kind: 'history', groups: snapshot.history };
    case 'discard':
      return null;
  }
}
