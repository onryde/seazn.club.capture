import { useCallback, useState } from 'react';
import { isBounce } from '@/domain/scoring/bounce';
import type { PadOutcome } from '@/domain/scoring/padLine';
import type { PadAsk, PadStateCard } from '@/domain/scoring/padView';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';
import { usePorts } from '@/hooks/usePorts';

/**
 * What every sport's sheets hook shares (plan S2-2 Task 7, lifted from badminton's `usePadSheets` so table tennis's
 * `useTableTennisSheets` does not copy it): the bounce window of a sheet appearing, Set score's two fields as typed,
 * and the reconnect question, which stands over every sheet and every card but a dead link's. A generic file: it names
 * no sport. Each sport's hook keeps its own sheets and what they say.
 */

/**
 * A sheet's button that records, through the taps' bounce memory (`useTaps`' `opening`, in `usePadTaps.ts`): the sheet
 * leaves with it, and a second touch on what was under it counts once (review I1, 2026-11-01). Whether it counted.
 */
export type Recording = (tap: string, make: () => PadOutcome) => boolean;

/** What a sport's sheets read of the match to ask the reconnect question: the question, and the card over the pad. */
export type AskFacts = {
  /** The reconnect question (owner ruling 43), while it stands: the real match's; the preview has none. */
  readonly ask?: PadAsk | null;
  readonly card: PadStateCard | null;
};

/**
 * The reconnect question as a sheet: shown for as long as it stands, over everything else, and its confirm (Discard's
 * second step) over it.
 */
export type AskView =
  | { readonly kind: 'ask'; readonly ask: PadAsk }
  /** Discard's confirm, over the question: Keep is the way back. */
  | { readonly kind: 'discard'; readonly ask: PadAsk };

/**
 * Whether the question is put now: it stands, and the scorer can answer it. Over every card but a dead link's (round 4,
 * item 4; the controller's ruling, 2026-11-03): under a view-only match, a match not yet started or a recorded result the
 * taps are still queued and the scorer must still choose, while a dead link takes both answers away and the question is
 * moot there (the runner says so).
 */
const asking = (facts: AskFacts): boolean =>
  (facts.ask ?? null) !== null && facts.card?.kind !== 'linkInvalid';

/**
 * The question's sheet, or null when none is put. `open` is the kind of the sheet the scorer has open, if any: only
 * Discard's confirm is shown as itself, over the question, and the question otherwise.
 */
export function askedView(open: string | undefined, facts: AskFacts): AskView | null {
  const ask = facts.ask ?? null;
  if (ask === null || !asking(facts)) return null;
  return { kind: open === 'discard' ? 'discard' : 'ask', ask };
}

/**
 * Whether an open sheet of kind `open` has no place now: no match under it; the question over it (the question is the
 * only sheet over the pad while it stands, its confirm aside); or its confirm with no question left.
 */
export function staleByAsk(open: string, facts: AskFacts | null): boolean {
  if (facts === null) return true;
  return asking(facts) ? open !== 'discard' : open === 'discard';
}

/**
 * Whether a tap now falls in the bounce window (`bounce.ts`) of the guarded step on screen appearing (the
 * coordinator's ruling, 2026-11-01). The second tap of a double tap on one step's button lands on the next step's, on
 * the same bottom edge, and ending a match is the costliest mistake on the pad: such a tap does nothing and says
 * nothing (the step still waits; the line is behind the dim). A step's time is the render it first shows in.
 */
export function useJustShown(step: string | null): () => boolean {
  const { clock } = usePorts();
  const [shown, setShown] = useState(() => ({ step, at: clock().getTime() }));
  if (shown.step !== step) setShown({ step, at: clock().getTime() });
  return useCallback(
    () => shown.step !== null && isBounce(clock().getTime() - shown.at),
    [shown, clock],
  );
}

/** What Set score does with two whole numbers. */
export type ScoreSetter = {
  readonly setScore: (first: number, second: number) => PadOutcome;
};

/**
 * Set score's two fields as typed: a field that is not a whole number is refused, as the pad refuses a bad score.
 * Quiet in the bounce window of the sheet appearing: the second touch of a double tap on the tool lands on Confirm.
 */
export function useSaveScore(
  pad: ScoreSetter,
  record: Recording,
  refuse: () => void,
  close: () => void,
  justShown: () => boolean,
) {
  return useCallback(
    (first: string, second: string) => {
      if (justShown()) return;
      close();
      const [top, bottom] = [parseWholeNumber(first), parseWholeNumber(second)];
      if (top === null || bottom === null) return refuse();
      record('setScore', () => pad.setScore(top, bottom));
    },
    [pad, record, refuse, close, justShown],
  );
}
