import { useCallback, useMemo, useState } from 'react';
import { chessMethodsFor, chessTakesResult } from '@/domain/scoring/chessPad';
import type {
  ChessColour,
  ChessDisplay,
  ChessMethod,
  ChessPadKey,
} from '@/domain/scoring/chessTypes';
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

/**
 * The sheets over the chess pad (plan S2-3 Task 3; spec §4; the Batch A review's rulings): the How sheet, which asks how a
 * game was won or drawn and records nothing until Record, then Match details, History, and the reconnect question over them
 * all. Table tennis's twin is `useTableTennisSheets`; what the sports share (the bounce window of a sheet appearing, the
 * question) is `usePadSheetParts`.
 */

/** What Record asks the match to do, and what it came to at once. */
export type ChessSheetDriver = {
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
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | null;

const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };

const NOT_NOW: PadOutcome = refusing('notNow');

/**
 * The sheet over the chess pad: a half or Draw shows How (`show`), a pick chooses a method or none, Record sends the result
 * and leaves, Cancel, the dim and Back close it with nothing sent. A pick or Record takes no tap in the bounce window of
 * the sheet appearing (`justShown`): the second touch of a double tap on a half lands on the sheet, on the same edge.
 * `record` is the bounce memory's (`useTaps`' `opening`): Record leaves the sheet with it, and a double tap counts once.
 */
export function useChessSheets(
  pad: ChessSheetDriver,
  snapshot: ChessSheetSnapshot | null,
  record: Recording,
) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const view = useMemo(() => sheetView(sheet, snapshot), [sheet, snapshot]);
  const justShown = useJustShown(guardedStep(view));
  const show = useShow(snapshot, setSheet);
  // No match to put a sheet over, the question over it, or nothing left for it to do: no sheet stays open behind it.
  if (sheet !== null && staleSheet(sheet, snapshot)) setSheet(null);
  const actions = useActions({ sheet, setSheet, snapshot, justShown, pad, record, cancel });
  return {
    open: sheet !== null,
    howOpen: sheet?.kind === 'how',
    cancel,
    show,
    actions,
    view,
    justShown,
  };
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
  readonly cancel: () => void;
};

function useActions({ sheet, setSheet, snapshot, justShown, pad, record, cancel }: Parts) {
  const details = useCallback(() => setSheet(DETAILS), [setSheet]);
  const history = useCallback(() => setSheet(HISTORY), [setSheet]);
  const dismiss = useCallback(() => {
    if (!justShown()) cancel();
  }, [justShown, cancel]);
  const pickMethod = useCallback(
    (method: ChessMethod | null) => {
      if (sheet?.kind !== 'how' || justShown()) return;
      if (method !== null && !chessMethodsFor(sheet.winner).includes(method)) return;
      setSheet({ ...sheet, picked: method });
    },
    [sheet, setSheet, justShown],
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

/**
 * The step on screen a double tap can reach, by name: the How sheet, Match details (whose dim takes the second touch on its
 * icon), the question and its confirm. Not History: its one button is not under its icon.
 */
function guardedStep(view: ChessSheetView | null): string | null {
  return view === null || view.kind === 'history' ? null : view.kind;
}

/**
 * Whether an open sheet has no place now: the question's rules (`staleByAsk`), or what it was for is gone. The How sheet was
 * for a live game under the colours it was opened with: a result, a tie-break, the organiser's lock, an abandon, or a
 * pairing from anyone ends it.
 */
function staleSheet(sheet: NonNullable<Sheet>, snapshot: ChessSheetSnapshot | null): boolean {
  if (snapshot === null || staleByAsk(sheet.kind, snapshot)) return true;
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
    case 'details':
      return { kind: 'details', details: snapshot.details };
    case 'history':
      return { kind: 'history', groups: snapshot.history };
    case 'discard':
      return null;
  }
}
