import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';

/**
 * The answer to Who is serving? while it waits for the next point (plan S2-2 Task 7; design §4.2, ruling 51): a side,
 * held in memory only, for the pad that asked. It is the scorer's word about the serve, and the engine reads it from the
 * next point that carries it (`TableTennisTap.rally.serving`), so it must ride exactly one point, and only while it can
 * still be read:
 *
 * - `put` replaces it (a second answer wins), and takes none while the pad needs none (`anchorNeeded` false);
 * - `carry` hands it to the point being tapped and clears it when that point was taken, not before: a point the match
 *   refused leaves it for the next. It clears synchronously, so two points tapped before the pad redraws cannot both
 *   carry it (a second `serving` would only blur the first at the engine);
 * - it goes when the engine names a server (`anchorNeeded` turns false), whatever named it, and is not back if the
 *   anchor is lost again: an answer made at one score is not an answer for another;
 * - it is tied to the score it was made at: `put` records the display's count of score events, and the answer goes the
 *   moment that count differs (another scorer's point that names no `serving` leaves the pad needing an answer, but a
 *   `serving` carried to the next rally would anchor the engine at the wrong score; a void or a refetch moves it too).
 *   `carry` hands the tap that count too (`servingAt`), and the domain drops an answer whose count is not the display's
 *   (`tableTennisEventFor`), so the wire invariant does not rest on this hook's commit alone;
 * - `clear` is for the tap that takes one back without moving the score (Undo of a card or a timeout); a point, a game
 *   score or an Undo that moves the count ends the answer by the count alone.
 *
 * `anchorNeeded` and `scoreEvents` are the display's (`TableTennisDisplay.anchorNeeded`, `.scoreEvents`).
 */
export function useHeldServing(anchorNeeded: boolean, scoreEvents: number) {
  const [side, setSide] = useState<PadSide | null>(null);
  // The answer a tap reads at once, which a redraw may not have caught up with, and the count of score events it was made at.
  const latest = useRef<{ readonly side: PadSide; readonly at: number } | null>(null);
  const clear = useCallback(() => {
    latest.current = null;
    setSide(null);
  }, []);
  // In the commit that shows the engine naming a server, or the score moved, before any tap can read an answer that no
  // longer holds.
  useLayoutEffect(() => {
    if (!anchorNeeded || (latest.current !== null && latest.current.at !== scoreEvents)) clear();
  }, [anchorNeeded, scoreEvents, clear]);
  const put = useCallback(
    (answer: PadSide): boolean => {
      if (!anchorNeeded) return false;
      latest.current = { side: answer, at: scoreEvents };
      setSide(answer);
      return true;
    },
    [anchorNeeded, scoreEvents],
  );
  const carry = useCallback(
    (send: (serving: PadSide | null, servingAt: number | null) => PadOutcome): PadOutcome => {
      const held = latest.current;
      const outcome = send(held?.side ?? null, held?.at ?? null);
      if (outcome.ok) clear();
      return outcome;
    },
    [clear],
  );
  return useMemo(() => ({ side, put, clear, carry }), [side, put, clear, carry]);
}
