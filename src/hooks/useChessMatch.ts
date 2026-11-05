import { useCallback, useEffect, useMemo, useState } from 'react';
import { chessSport } from '@/domain/scoring/chessSport';
import type {
  ChessArmageddonResult,
  ChessMethod,
  ChessPadKey,
  ChessRung,
  ChessTiebreakScore,
  ChessTypes,
} from '@/domain/scoring/chessTypes';
import { refusing, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import type { ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import {
  useChessSheets,
  type ChessSheetDriver,
  type ChessSheetSnapshot,
  type ChessSheetView,
} from '@/hooks/useChessSheets';
import { useAskActions, useClosedByDeadLink, useStartActions } from '@/hooks/usePadMatchParts';
import { useSettle, useTaps, type PadTapDriver } from '@/hooks/usePadTaps';
import { usePorts, type Ports } from '@/hooks/usePorts';
import { useLinks, useScoringMatch, useSender, type MatchSender } from '@/hooks/useScoringMatch';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';

/**
 * A chess game on the pad screen (plan S2-3 Task 3): the generic match (`useScoringMatch`) with chess's pad hook, as
 * `useTableTennisMatch` is table tennis's. What is chess's here: the two halves and Draw open a sheet that asks How and
 * record nothing until Record (`useChessSheets`), Swap colours is one pairing, Undo is the result's alone, and there is
 * no serve to pick: Start match starts at once. A drawn knockout game owes a tie-break (S2-3b): its Tie-break tile opens a
 * sheet of its own that records nothing until Record either.
 */

/**
 * Chess's own buttons, beside every pad's (`PadActions`): a result chosen for a seat (null: a draw), a method picked or
 * none, Record and Cancel of the sheet that asks How, Swap colours, the Start screen, and the reconnect question's answers.
 */
export type ChessPadActions = PadActions & {
  /** A half or Draw: opens the sheet that asks How. Nothing is sent until Record. */
  readonly choose: (winner: PadSide | null) => void;
  /** A method of the list on the sheet, or none (tapping the picked one again). */
  readonly pickMethod: (method: ChessMethod | null) => void;
  readonly record: () => void;
  /**
   * The How sheet's Cancel and its dim: quiet in the bounce window of the sheet appearing, since the second touch of a double
   * tap on a half lands on one of them. `cancel` is Back's, the background's and a dead link's close, with no such window.
   */
  readonly cancelSheet: () => void;
  /**
   * The tie-break sheet's steps (S2-3b): the rung, who won a rapid or blitz tie-break and its score (or none), who had Black in
   * an Armageddon and how it ended, and Record, the only one that sends. A pick that is not for the step on screen does nothing.
   */
  readonly pickRung: (rung: ChessRung) => void;
  readonly pickTiebreakWinner: (side: PadSide) => void;
  readonly pickScore: (score: ChessTiebreakScore | null) => void;
  readonly pickBlack: (side: PadSide) => void;
  readonly pickArmageddonResult: (result: ChessArmageddonResult) => void;
  readonly recordTiebreak: () => void;
  readonly swap: () => void;
  /** The Start screen: chess has no serve to pick (the kit draws no picker), so `pickServer` is the kit's unused button. */
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
  /** The reconnect question (owner ruling 43): Send my taps, Discard them (which asks again) and its confirm's Discard. */
  readonly sendTaps: () => void;
  readonly askDiscard: () => void;
  readonly confirmDiscard: () => void;
};

/** What the chess pad screen is drawn from. */
export type ChessPadModel = PadScreenModel<ChessPadKey, ChessSheetView> & {
  /** The Start screen's pick of a side: chess has none to make, so it is always none. */
  readonly toss: PadSide | null;
  readonly actions: ChessPadActions;
};

export function useChessMatch(fixtureId: string): ScoringMatch<ChessPadModel> {
  return useScoringMatch(fixtureId, chessSport, useChessPad);
}

type PadFacts = MatchPad<ChessTypes>;
type Sender = MatchSender<ChessTypes>;

/** The session record's line for a result recorded: the method chosen as a short word, never a name (ruling 8). */
export const METHOD_EVENT = 'scoring.chess.method';

/** What the record says when a result is recorded with no method. */
const NO_METHOD = 'none';

/**
 * The session record's line for a tie-break recorded: the rung as a short word, never a name or an entrant (ruling 8). The
 * field is `word`, as the method's: the allow-list (`scrub.ts`) passes it, and masks a key it has not been told of.
 */
export const TIEBREAK_EVENT = 'scoring.chess.tiebreak';

/** Chess flashes no half: a result is not a point scored (the pad's halves have no flash to draw). */
const ignoreFlash = (): void => undefined;

const NOTHING_TO_UNDO: PadOutcome = refusing('nothingToUndo');
const NOT_NOW: PadOutcome = refusing('notNow');

/**
 * The taps the bounce memory drives. Chess has no rally: a half opens a sheet (`choose`), never a tap of its own. Undo is
 * the result's alone: the generic Undo takes this phone's last tap back, which could be a swap (the Batch A review's
 * ruling 5), and a swap is taken back by swapping again.
 */
function useChessDriver(sender: Sender, undoable: boolean): PadTapDriver {
  return useMemo(
    () => ({
      rally: () => NOT_NOW,
      undo: () => (undoable ? sender.undo() : NOTHING_TO_UNDO),
    }),
    [sender, undoable],
  );
}

function useChessPad(
  ports: Ports,
  runner: ScoringRunner | null,
  pad: PadFacts | null,
): ChessPadModel | null {
  const sender = useSender<ChessTypes>(ports, runner);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const settle = useSettle(sender.say);
  const driver = useChessDriver(sender, pad?.display.undoable ?? false);
  const taps = useTaps(driver, settle, sender.say, ignoreFlash);
  const sheets = useSheets(ports, sender, taps, pad);
  const actions = useActions({ sender, runner, pad, taps, sheets, setCardNote });
  useBackCloses(sheets.open, sheets.cancel);
  useClosedInBackground(sheets.howOpen || sheets.tiebreakOpen, sheets.cancel);
  return useMemo(
    () => modelOf(pad, sheets.view, cardNote, actions),
    [pad, sheets.view, cardNote, actions],
  );
}

/** What the screen is drawn from, or none while the match is loading. */
function modelOf(
  pad: PadFacts | null,
  sheet: ChessSheetView | null,
  cardNote: MessageKey | null,
  actions: ChessPadActions,
): ChessPadModel | null {
  if (pad === null) return null;
  return {
    kind: 'pad',
    view: pad.view,
    sheet,
    line: pad.line,
    cardNote,
    // Chess flashes no half: a result is not a point scored.
    flash: null,
    toss: pad.toss,
    actions,
  };
}

/**
 * The sheets over the pad. Record sends the result and logs the method chosen as a short word; closed at once when the
 * link dies, since the bad-link card then shows (round 8 hardening).
 */
function useSheets(
  ports: Ports,
  sender: Sender,
  taps: ReturnType<typeof useTaps>,
  pad: PadFacts | null,
) {
  const { tap } = sender;
  const { logger } = ports;
  const { opening, arm } = taps;
  const driver = useMemo<ChessSheetDriver>(
    () => ({
      result: (winner, method) => {
        const outcome = tap({ kind: 'result', winner, method });
        // The method, as the short word it is: no name, no id (it is not a secret, and `word` is on the record's allow-list).
        if (outcome.ok) logger.info(METHOD_EVENT, { word: method ?? NO_METHOD });
        return outcome;
      },
      tiebreak: (choice) => {
        const outcome = tap(choice);
        if (outcome.ok) logger.info(TIEBREAK_EVENT, { word: choice.rung });
        return outcome;
      },
    }),
    [tap, logger],
  );
  const snapshot = useMemo<ChessSheetSnapshot | null>(
    () =>
      pad === null
        ? null
        : {
            display: pad.display,
            details: pad.view.details,
            history: pad.history,
            card: pad.view.card,
            ask: pad.ask,
          },
    [pad],
  );
  const sheets = useChessSheets(driver, snapshot, opening, arm);
  useClosedByDeadLink(pad?.view, sheets.open, sheets.cancel);
  return sheets;
}

/** The How and tie-break sheets go with the app to the background: a question left open on a locked phone is stale when it comes back. */
function useClosedInBackground(open: boolean, cancel: () => void): void {
  const { foreground } = usePorts();
  useEffect(() => {
    if (!open) return;
    return foreground.subscribeBackground(cancel);
  }, [foreground, open, cancel]);
}

type Parts = {
  readonly sender: Sender;
  readonly runner: ScoringRunner | null;
  readonly pad: PadFacts | null;
  readonly taps: ReturnType<typeof useTaps>;
  readonly sheets: ReturnType<typeof useSheets>;
  readonly setCardNote: (note: MessageKey | null) => void;
};

function useActions(parts: Parts): ChessPadActions {
  const { taps, sheets } = parts;
  const home = useBackToHome();
  const start = useStart(parts);
  const asked = useAsk(parts);
  const links = useLinks(parts.runner, parts.setCardNote);
  const picking = usePicking(parts);
  const { cancel } = sheets;
  const { undo } = taps;
  return useMemo(
    () => ({
      home,
      undo,
      cancel,
      ...sheets.actions,
      cancelSheet: sheets.actions.dismiss,
      ...picking,
      ...asked,
      ...links,
      ...start,
    }),
    [home, undo, cancel, sheets.actions, picking, asked, links, start],
  );
}

/** Start match is a tap with no side (chess has no serve), through the bounce memory; the kit's picker is never drawn. */
function useStart({ sender, runner, pad, taps }: Parts) {
  const { tap } = sender;
  const startWith = useCallback(() => tap({ kind: 'start' }), [tap]);
  // The literal `false` is load-bearing: it is what makes Start match start at once, with no pick (the Task 2 review).
  return useStartActions(runner, pad?.toss ?? null, startWith, taps.opening, false);
}

/** The reconnect question's answers (owner ruling 43), the same for every sport (`useAskActions`). */
function useAsk({ sender, taps, sheets }: Parts) {
  return useAskActions(sender.answer, taps.opening, sheets.justShown, sheets.actions.askDiscard);
}

/** The opening taps' names in the bounce memory: a repeat of one counts once, and so does any tap on the heels of it. */
const CHOOSE_TAP = 'choose';
const SWAP_TAP = 'swap';
const TIEBREAK_TILE_TAP = 'tiebreakTile';

/** The tool cells' ids, as the pad names them (`chessPad.ts`). */
const DRAW_TOOL = 'draw';
const SWAP_TOOL = 'swap';
const TIEBREAK_TOOL = 'tiebreak';

/**
 * What a tap on a half, Draw and Swap colours do. Each is an opening tap (`useTaps`): the second touch of a double tap
 * counts once, and so does any tap on the heels of a sheet's recording (the Batch A review's ruling 4). A half or Draw
 * opens the How sheet; Swap colours is one pairing; the Tie-break tile opens the tie-break sheet. A tool needs no guard of
 * `useGuardedTool`'s: each of its cells is an opening tap itself, and the same memory refuses them.
 */
function usePicking({ sender, taps, sheets }: Parts) {
  const { tap } = sender;
  const { opening } = taps;
  const { show, showTiebreak } = sheets;
  const choose = useCallback(
    (winner: PadSide | null) => void opening(CHOOSE_TAP, () => show(winner)),
    [opening, show],
  );
  const swap = useCallback(
    () => void opening(SWAP_TAP, () => tap({ kind: 'swap' })),
    [opening, tap],
  );
  const tiebreak = useCallback(
    () => void opening(TIEBREAK_TILE_TAP, showTiebreak),
    [opening, showTiebreak],
  );
  const tool = useCallback(
    (id: string) => {
      if (id === DRAW_TOOL) choose(null);
      else if (id === SWAP_TOOL) swap();
      else if (id === TIEBREAK_TOOL) tiebreak();
    },
    [choose, swap, tiebreak],
  );
  return useMemo(() => ({ choose, swap, tool, tapHalf: choose }), [choose, swap, tool]);
}
