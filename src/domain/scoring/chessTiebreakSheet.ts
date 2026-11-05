import {
  CHESS_TIEBREAK_SCORES,
  type ChessArmageddonResult,
  type ChessRung,
  type ChessTiebreakScore,
  type ChessTiebreakState,
  type ChessTiebreakTap,
} from '@/domain/scoring/chessTypes';
import type { PadSide } from '@/domain/scoring/padView';

/**
 * The tie-break sheet's steps (S2-3b Task 2; design §3), as the web's arbiter pad walks them: the rung (skipped when the
 * stage lists exactly one), then, for a rapid or blitz tie-break, who won and the optional score; for an Armageddon, who had
 * Black and how it ended, then the confirm that says who advances. Nothing is sent before Record. Every choice names a SEAT,
 * never a colour of the main game: the tie-break has a colour of its own (the Armageddon's Black), so the sheet runs the same
 * in a division that plays without colours, and a pairing from another scorer cannot change the player chosen.
 */

/** What the scorer has chosen so far: each field is set by the step that asks for it, and by no other. */
export type TiebreakDraft = {
  readonly rung: ChessRung | null;
  /** Rapid or blitz: the seat that won (and advances). */
  readonly winner: PadSide | null;
  /** Rapid or blitz: the mini-match score, or none. */
  readonly score: ChessTiebreakScore | null;
  /** Armageddon: the seat that had Black. */
  readonly black: PadSide | null;
  /** Armageddon: how it ended, from White's side. */
  readonly result: ChessArmageddonResult | null;
};

/** The step on screen: the one that asks for the first thing not yet chosen, and the last step of each rung. */
export type TiebreakStep = 'rung' | 'winner' | 'score' | 'black' | 'result' | 'confirm';

const BLANK: TiebreakDraft = { rung: null, winner: null, score: null, black: null, result: null };

/** The sheet as it opens: on the rung, or, when the stage lists exactly one, on that rung's first step. */
export const startTiebreak = (rungs: readonly ChessRung[]): TiebreakDraft =>
  rungs.length === 1 ? { ...BLANK, rung: rungs[0] ?? null } : BLANK;

export function tiebreakStep(draft: TiebreakDraft): TiebreakStep {
  if (draft.rung === null) return 'rung';
  if (draft.rung !== 'armageddon') return draft.winner === null ? 'winner' : 'score';
  if (draft.black === null) return 'black';
  return draft.result === null ? 'result' : 'confirm';
}

/** The rung the stage plays, while the sheet is asking for it. */
export function chooseRung(
  draft: TiebreakDraft,
  rung: ChessRung,
  rungs: readonly ChessRung[],
): TiebreakDraft {
  if (tiebreakStep(draft) !== 'rung' || !rungs.includes(rung)) return draft;
  return { ...draft, rung };
}

/** Who won a rapid or blitz tie-break, while the sheet is asking. */
export function chooseWinner(draft: TiebreakDraft, winner: PadSide): TiebreakDraft {
  return tiebreakStep(draft) === 'winner' ? { ...draft, winner } : draft;
}

/** The mini-match score (or none), while the sheet is on it: a score the wire does not take is no choice. */
export function chooseScore(draft: TiebreakDraft, score: ChessTiebreakScore | null): TiebreakDraft {
  if (tiebreakStep(draft) !== 'score') return draft;
  if (score !== null && !CHESS_TIEBREAK_SCORES.includes(score)) return draft;
  return { ...draft, score };
}

/** Who had Black in an Armageddon, while the sheet is asking. */
export function chooseBlack(draft: TiebreakDraft, black: PadSide): TiebreakDraft {
  return tiebreakStep(draft) === 'black' ? { ...draft, black } : draft;
}

/** How an Armageddon ended, while the sheet is asking. */
export function chooseResult(draft: TiebreakDraft, result: ChessArmageddonResult): TiebreakDraft {
  return tiebreakStep(draft) === 'result' ? { ...draft, result } : draft;
}

/**
 * The tie-break the draft comes to, or none while it is incomplete: Record is the score step's (a rapid or blitz tie-break,
 * whose score is optional) and the confirm's (an Armageddon, whose scorer never names a winner).
 */
export function tiebreakTapOf(draft: TiebreakDraft): ChessTiebreakTap | null {
  const step = tiebreakStep(draft);
  const { rung, winner, black, result } = draft;
  if (step === 'score' && rung !== 'armageddon' && rung !== null && winner !== null) {
    return { kind: 'tiebreak', rung, winner, score: draft.score };
  }
  if (step === 'confirm' && black !== null && result !== null) {
    return { kind: 'tiebreak', rung: 'armageddon', black, result };
  }
  return null;
}

/**
 * Whether the sheet has no place now: no tie-break is owed (another scorer recorded one, the organiser settled the game or
 * a void took the draw away), or the rung picked is not one the stage plays any more.
 */
export function tiebreakStale(draft: TiebreakDraft, tiebreak: ChessTiebreakState): boolean {
  if (!tiebreak.pending) return true;
  return draft.rung !== null ? !tiebreak.rungs.includes(draft.rung) : tiebreak.rungs.length === 0;
}
