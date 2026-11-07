import { useCallback, useMemo } from 'react';
import {
  chooseBlack,
  chooseResult,
  chooseRung,
  chooseScore,
  chooseWinner,
  startTiebreak,
  tiebreakStep,
  tiebreakTapOf,
  type TiebreakDraft,
  type TiebreakStep,
} from '@/domain/scoring/chessTiebreakSheet';
import {
  advancerOf,
  type ChessArmageddonResult,
  type ChessRung,
  type ChessTiebreakScore,
  type ChessTiebreakState,
  type ChessTiebreakTap,
} from '@/domain/scoring/chessTypes';
import { TAKEN, refusing, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { Recording } from '@/hooks/usePadSheetParts';

/**
 * The tie-break sheet's part of the chess sheets hook (S2-3b Task 2; design §3), lifted out of `useChessSheets` so that file
 * keeps its size: the view the sheet is drawn from, the opening, and the six buttons. The steps themselves are the domain's
 * (`chessTiebreakSheet.ts`); this only adds the bounce memory and the one tap.
 */

/** What Record asks the match to do: the tie-break, and what it came to at once. */
export type ChessTiebreakDriver = {
  readonly tiebreak: (tap: ChessTiebreakTap) => PadOutcome;
};

/**
 * The tie-break sheet as it is drawn: the step on screen, the rungs the stage plays (the rung step's choices, in its order),
 * what is chosen so far, and, once the draft is complete, the seat that advances.
 */
export type TiebreakView = {
  readonly kind: 'tiebreak';
  readonly step: TiebreakStep;
  readonly rungs: readonly ChessRung[];
  readonly draft: TiebreakDraft;
  readonly advances: PadSide | null;
};

export function tiebreakView(draft: TiebreakDraft, tiebreak: ChessTiebreakState): TiebreakView {
  const tap = tiebreakTapOf(draft);
  return {
    kind: 'tiebreak',
    step: tiebreakStep(draft),
    rungs: tiebreak.rungs,
    draft,
    advances: tap === null ? null : advancerOf(tap),
  };
}

/** The name the sheet's Record has in the bounce memory. */
const TIEBREAK_TAP = 'tiebreak';

const NOT_NOW: PadOutcome = refusing('notNow');

/**
 * Opens the sheet when a tie-break is owed and the stage lists a rung to ask about: otherwise it is not now (a tile drawn a
 * moment ago may be gone). The sheet starts on the rung, or past it for a stage that lists one.
 */
export function useShowTiebreak(
  tiebreak: ChessTiebreakState | null,
  setDraft: (draft: TiebreakDraft) => void,
): () => PadOutcome {
  return useCallback((): PadOutcome => {
    if (tiebreak === null || !tiebreak.pending || tiebreak.rungs.length === 0) return NOT_NOW;
    setDraft(startTiebreak(tiebreak.rungs));
    return TAKEN;
  }, [tiebreak, setDraft]);
}

type Parts = {
  /** The draft of the tie-break sheet open, or none when another sheet or none is. */
  readonly draft: TiebreakDraft | null;
  readonly rungs: readonly ChessRung[];
  readonly setDraft: (draft: TiebreakDraft) => void;
  readonly close: () => void;
  readonly justShown: () => boolean;
  readonly pad: ChessTiebreakDriver;
  readonly record: Recording;
};

/**
 * The sheet's buttons. A pick moves the sheet on, and a pick or Record takes no tap in the bounce window of its step
 * appearing (`justShown`): the second touch of a double tap on a row lands on the next step, on the same edge, and a choice
 * there would be one nobody made. A pick that is not for the step on screen changes nothing (the domain's rule).
 */
export function useTiebreakActions({
  draft,
  rungs,
  setDraft,
  close,
  justShown,
  pad,
  record,
}: Parts) {
  const choose = useCallback(
    (next: (draft: TiebreakDraft) => TiebreakDraft) => {
      if (draft === null || justShown()) return;
      const moved = next(draft);
      if (moved !== draft) setDraft(moved);
    },
    [draft, justShown, setDraft],
  );
  const pickRung = useCallback(
    (rung: ChessRung) => choose((was) => chooseRung(was, rung, rungs)),
    [choose, rungs],
  );
  const pickTiebreakWinner = useCallback(
    (side: PadSide) => choose((was) => chooseWinner(was, side)),
    [choose],
  );
  const pickScore = useCallback(
    (score: ChessTiebreakScore | null) => choose((was) => chooseScore(was, score)),
    [choose],
  );
  const pickBlack = useCallback(
    (side: PadSide) => choose((was) => chooseBlack(was, side)),
    [choose],
  );
  const pickArmageddonResult = useCallback(
    (result: ChessArmageddonResult) => choose((was) => chooseResult(was, result)),
    [choose],
  );
  const recordTiebreak = useCallback(() => {
    const tap = draft === null ? null : tiebreakTapOf(draft);
    if (tap === null || justShown()) return;
    close();
    record(TIEBREAK_TAP, () => pad.tiebreak(tap));
  }, [draft, justShown, close, record, pad]);
  return useMemo(
    () => ({
      pickRung,
      pickTiebreakWinner,
      pickScore,
      pickBlack,
      pickArmageddonResult,
      recordTiebreak,
    }),
    [pickRung, pickTiebreakWinner, pickScore, pickBlack, pickArmageddonResult, recordTiebreak],
  );
}
