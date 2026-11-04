import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { isBounce } from '@/domain/scoring/bounce';
import {
  REFUSAL_WORDS,
  noteLine,
  refusalLine,
  type PadLineWords,
  type PadOutcome,
} from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import { usePorts } from '@/hooks/usePorts';

/**
 * The tap logic both pads share (plan S2-1 Task 9): the preview's fake and the real match. A tap counts once for a
 * repeat inside the bounce window, the line says so, and a refusal says why. The driver is the one thing that differs:
 * what a rally and an Undo do (the fake's counters, or an event handed to the match's reducer).
 */

/** What a rally on a half and an Undo do, and what each came to at once. */
export type PadTapDriver = {
  readonly rally: (side: PadSide) => PadOutcome;
  readonly undo: () => PadOutcome;
};

export type Say = (words: PadLineWords) => void;
export type SetFlash = (flash: HalfFlash) => void;

const COUNTED_ONCE: PadLineWords = noteLine('scoring.pad.countedOnce');

/** A recorded tap clears what the line said; a refused one says why. */
export function useSettle(say: Say): (outcome: PadOutcome) => void {
  return useCallback(
    (outcome: PadOutcome) => say(outcome.ok ? null : refusalLine(REFUSAL_WORDS[outcome.refusal])),
    [say],
  );
}

/** Start match's tap in the bounce memory. */
export const START_TAP = 'start';

/** A tap the pad counted: which, when, and whether its control left the screen with it (`opening`). */
type Counted = { readonly tap: string; readonly at: number; readonly opens: boolean };
type Once = (tap: string, make: () => PadOutcome, opens?: boolean) => boolean;
/** A tap whose control leaves the screen with it, through the bounce memory (`useTaps`): whether it counted. */
export type Opening = (tap: string, make: () => PadOutcome) => boolean;

/**
 * A tap on a half and Undo: each counts once for a repeat within the bounce window (`bounce.ts`) of its own last
 * recorded tap, and the line says "Counted once" under the sentence of the tap that counted. A rally on the other half
 * is a different tap and always counts. A tap whose control leaves the screen with it (`opening`: Start match, and a
 * sheet's button that records: a sanction, Set score, Record the ending, Void) opens the window for every tap: the
 * second touch of a double tap on it lands on what was under it, a half, Undo or a tool (hardening and review I1,
 * 2026-11-01), and counts once with it; a tool then opens nothing (`secondTouch`). A tool that scores a point and stays
 * on screen (table tennis's 13 returns) is a `point`: it counts once as a half does, under its own name, and flashes the
 * half it credited.
 */
export function useTaps(
  pad: PadTapDriver,
  settle: (outcome: PadOutcome) => void,
  say: Say,
  setFlash: SetFlash,
) {
  const { clock } = usePorts();
  const last = useRef<Counted | null>(null);
  const once = useOnce(last, settle, say);
  const point = usePoint(once, setFlash);
  const tapHalf = useCallback(
    (side: PadSide) => point(side, side, () => pad.rally(side)),
    [point, pad],
  );
  const undo = useCallback(() => void once('undo', () => pad.undo()), [once, pad]);
  const opening = useCallback<Opening>((tap, make) => once(tap, make, true), [once]);
  const secondTouch = useCallback((): boolean => {
    const prior = last.current;
    if (prior === null || !prior.opens || !isBounce(clock().getTime() - prior.at)) return false;
    say(COUNTED_ONCE);
    return true;
  }, [clock, say]);
  return useMemo(
    () => ({ tapHalf, point, undo, opening, secondTouch }),
    [tapHalf, point, undo, opening, secondTouch],
  );
}

/**
 * Counts a tap once (`useTaps`): a repeat within the window of the last tap counted, or any tap within the window of
 * an opening one, is not made, and the line says "Counted once". A refused tap arms nothing.
 */
function useOnce(
  last: RefObject<Counted | null>,
  settle: (outcome: PadOutcome) => void,
  say: Say,
): Once {
  const { clock } = usePorts();
  return useCallback(
    (tap, make, opens = false) => {
      const at = clock().getTime();
      const prior = last.current;
      const repeat = prior !== null && (prior.tap === tap || prior.opens);
      if (repeat && isBounce(at - prior.at)) {
        say(COUNTED_ONCE);
        return false;
      }
      const outcome = make();
      settle(outcome);
      if (outcome.ok) last.current = { tap, at, opens };
      return outcome.ok;
    },
    [last, clock, settle, say],
  );
}

/** A point for a side: a point on `side`, made by tap `tap` ("first", "returns"), once (`useOnce`), then the half's flash. */
export type Point = (tap: string, side: PadSide, make: () => PadOutcome) => void;

/**
 * A point for `side` under the name `tap`, once (`useOnce`), and the half's flash, numbered on from the last one (owner
 * ruling 14). A bounce or a refusal flashes nothing.
 */
function usePoint(once: Once, setFlash: SetFlash): Point {
  const flashes = useRef(0);
  return useCallback(
    (tap, side, make) => {
      if (!once(tap, make)) return;
      flashes.current += 1;
      setFlash({ side, seq: flashes.current });
    },
    [once, setFlash],
  );
}

/** A tool's sheet, unless the tap is an opening tap's second touch (`useTaps`' `secondTouch`): then it opens nothing. */
export function useGuardedTool(secondTouch: () => boolean, open: (id: string) => void) {
  return useCallback(
    (id: string) => {
      if (!secondTouch()) open(id);
    },
    [secondTouch, open],
  );
}
