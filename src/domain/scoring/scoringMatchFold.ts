import {
  foldBadminton,
  type BadmintonFold,
  type BadmintonFoldInput,
} from '@/domain/scoring/badmintonFold';

/**
 * The match's fold, remembered (plan S2-1 Task 9: "the fold is memoized"). A tap, the display, Undo and the history all
 * fold the same ledger, queue and pick: one fold answers them while none of the five has moved, however many callers
 * ask. One entry, by what the fold reads: the lists by their members, the rest by identity.
 *
 * Pure but for the entry it keeps: a fold is a function of its input, so a hit is the answer a fresh fold would give.
 */
let last: { readonly input: BadmintonFoldInput; readonly fold: BadmintonFold } | null = null;

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a === b || (a.length === b.length && a.every((item, i) => item === b[i]));

const sameInput = (a: BadmintonFoldInput, b: BadmintonFoldInput): boolean =>
  a.bootstrap === b.bootstrap &&
  a.toss === b.toss &&
  sameList(a.ledger, b.ledger) &&
  sameList(a.queued, b.queued) &&
  sameList(a.ownEventIds, b.ownEventIds);

export function foldMemo(input: BadmintonFoldInput): BadmintonFold {
  if (last !== null && sameInput(last.input, input)) return last.fold;
  const fold = foldBadminton(input);
  last = { input, fold };
  return fold;
}
