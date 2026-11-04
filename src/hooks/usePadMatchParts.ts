import { useCallback, useEffect, useMemo } from 'react';
import type { PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide, PadView } from '@/domain/scoring/padView';
import type { ScoringRunner } from '@/hooks/scoringRunner';
import { START_TAP, type Opening } from '@/hooks/usePadTaps';

/**
 * What every set-based sport's match hook does alike (plan S2-2 Task 7, lifted from `useBadmintonMatch` so
 * `useTableTennisMatch` does not copy it): the Start screen's two buttons, the reconnect question's answers, and the
 * sheets going away with a dead link. A generic file: it names no sport; the sport hands in the one thing that is its
 * own (the tap that starts its match).
 */

type StartActions = {
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
};

/**
 * The Start screen (owner, 2026-11-01, option A): the pick goes to the match, and Start match is a tap carrying it,
 * through the bounce memory. `startWith` makes the sport's start tap for the picked side: keep it stable
 * (`useCallback`), or `start` changes on every render. Start match waits for a pick: with none, it starts nothing.
 */
export function useStartActions(
  runner: ScoringRunner | null,
  toss: PadSide | null,
  startWith: (server: PadSide) => PadOutcome,
  opening: Opening,
): StartActions;
/**
 * A sport with no serve to pick (plan S2-3 Task 2: its view's `PadStart.needsToss` is false, and the kit shows no
 * picker): Start match starts at once, with no side, whatever was or was not picked.
 */
export function useStartActions(
  runner: ScoringRunner | null,
  toss: PadSide | null,
  startWith: () => PadOutcome,
  opening: Opening,
  needsToss: false,
): StartActions;
export function useStartActions(
  runner: ScoringRunner | null,
  toss: PadSide | null,
  startWith: (...server: readonly PadSide[]) => PadOutcome,
  opening: Opening,
  needsToss = true,
): StartActions {
  const pickServer = useCallback(
    (side: PadSide) => void runner?.dispatch({ kind: 'pickServer', side }),
    [runner],
  );
  const start = useCallback(() => {
    if (!needsToss) opening(START_TAP, () => startWith());
    else if (toss !== null) opening(START_TAP, () => startWith(toss));
  }, [opening, startWith, toss, needsToss]);
  return useMemo(() => ({ pickServer, start }), [pickServer, start]);
}

/**
 * The reconnect question's answers (owner ruling 43): each an opening tap (`useTaps`), quiet in the bounce window of the
 * sheet appearing. The sheet leaves with the answer, and a second touch on what was under it, a half or Undo, counts
 * once with it. Discard's first button only opens its confirm (`askDiscard`, the sheets').
 */
export function useAskActions(
  answer: (answer: 'send' | 'discard') => PadOutcome,
  opening: Opening,
  justShown: () => boolean,
  askDiscard: () => void,
) {
  const sendTaps = useCallback(() => {
    if (!justShown()) opening('ask', () => answer('send'));
  }, [opening, answer, justShown]);
  const confirmDiscard = useCallback(() => {
    if (!justShown()) opening('discardAsk', () => answer('discard'));
  }, [opening, answer, justShown]);
  return useMemo(
    () => ({ sendTaps, confirmDiscard, askDiscard }),
    [sendTaps, confirmDiscard, askDiscard],
  );
}

/** The sheets over the pad close at once when the link dies, since the bad-link card then shows (round 8 hardening). */
export function useClosedByDeadLink(
  view: PadView<string> | undefined,
  open: boolean,
  cancel: () => void,
): void {
  const dead = view?.card?.kind === 'linkInvalid';
  useEffect(() => {
    if (dead && open) cancel();
  }, [dead, open, cancel]);
}
