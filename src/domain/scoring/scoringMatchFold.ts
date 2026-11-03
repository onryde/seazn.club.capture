import type { SportFoldInput } from '@/domain/scoring/scoringSport';

/**
 * A sport's fold, remembered (plan S2-1 Task 9: "the fold is memoized"). A tap, the display, Undo and the history all
 * fold the same ledger, queue and pick: one fold answers them while none of the five has moved, however many callers
 * ask. One entry, by what the fold reads: the lists by their members, the rest by identity.
 *
 * A sport wraps its own fold with it (`badmintonSport.fold`), so the entry is that sport's, typed by it. Pure but for
 * the entry it keeps: a fold is a function of its input, so a hit is the answer a fresh fold would give.
 */
export function memoFold<Fold>(
  fold: (input: SportFoldInput) => Fold,
): (input: SportFoldInput) => Fold {
  let last: { readonly input: SportFoldInput; readonly fold: Fold } | null = null;
  return (input) => {
    if (last !== null && sameInput(last.input, input)) return last.fold;
    const folded = fold(input);
    last = { input, fold: folded };
    return folded;
  };
}

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a === b || (a.length === b.length && a.every((item, i) => item === b[i]));

const sameInput = (a: SportFoldInput, b: SportFoldInput): boolean =>
  a.bootstrap === b.bootstrap &&
  a.toss === b.toss &&
  sameList(a.ledger, b.ledger) &&
  sameList(a.queued, b.queued) &&
  sameList(a.ownEventIds, b.ownEventIds);
