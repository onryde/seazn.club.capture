import { useCallback, useMemo, useState } from 'react';
import { isBounce } from '@/domain/scoring/bounce';
import {
  badmintonDetails,
  parseBadmintonTool,
  type BadmintonDisplay,
  type BadmintonPadKey,
  type BadmintonSanction,
} from '@/domain/scoring/badmintonPad';
import {
  chooseSanction,
  sanctionSheet,
  startSanction,
  type SanctionSheet,
  type SanctionStep,
} from '@/domain/scoring/badmintonSanction';
import type { PadOutcome } from '@/domain/scoring/padLine';
import type {
  PadAsk,
  PadHistoryGroup,
  PadMatchDetails,
  PadStateCard,
} from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';
import { usePorts } from '@/hooks/usePorts';

/** What a sanction and a set score do, and what each came to at once: the fake's counters, or a tap for the match's reducer. */
export type PadSheetDriver = {
  readonly sanction: (sanction: BadmintonSanction) => PadOutcome;
  readonly setScore: (first: number, second: number) => PadOutcome;
};

/** What the sheets are drawn from: the display, History as grouped for the sheet, and the card over the pad. */
export type PadSheetSnapshot = {
  readonly display: BadmintonDisplay;
  readonly history: readonly PadHistoryGroup<BadmintonPadKey>[];
  readonly card: PadStateCard | null;
  /** The reconnect question (owner ruling 43), while it stands: the real match's; the preview has none. */
  readonly ask?: PadAsk | null;
};

/**
 * What is over the pad: a sanction's step, the Set score fields, a disqualification's ending prompt, Match details
 * (where the match sits and its rules: owner ruling 15, then 2026-11-01), or its History (owner ruling 21), a cover the
 * full height of the pad.
 */
export type PadSheetView =
  | { readonly kind: 'sanction'; readonly sheet: SanctionSheet }
  | {
      readonly kind: 'setScore';
      /** The game it sets, the one the strip names (the controller's call, 2026-10-31): "Set score · Game 2". */
      readonly game: number;
      readonly names: readonly [string, string];
      readonly points: readonly [number, number];
    }
  | { readonly kind: 'ending'; readonly person: string }
  | { readonly kind: 'details'; readonly details: PadMatchDetails<BadmintonPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<BadmintonPadKey>[] }
  /** The reconnect question (owner ruling 43): shown for as long as it stands, like the ending prompt, and over it. */
  | { readonly kind: 'ask'; readonly ask: PadAsk }
  /** Discard's confirm, over the question: Keep is the way back. */
  | { readonly kind: 'discard'; readonly ask: PadAsk };

type Sheet =
  | { readonly kind: 'sanction'; readonly step: SanctionStep }
  | { readonly kind: 'setScore' }
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | null;

const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };

/**
 * A sheet's button that records, through the taps' bounce memory (`useTaps`' `opening`, in `usePadTaps.ts`): the sheet
 * leaves with it, and a second touch on what was under it counts once (review I1, 2026-11-01). Whether it counted.
 */
type Recording = (tap: string, make: () => PadOutcome) => boolean;
type SetSheet = (sheet: Sheet) => void;

/**
 * The sheet over the badminton pad: a tool, Match details or History opens one, a sanction's steps move
 * through it, Cancel, Close and Back close it. A second Match details or History tap opens nothing more: one Back
 * still closes it. The ending prompt is not a sheet the scorer opens: it shows for as long as a disqualification waits,
 * on the pad (none under a card). History is view only: it reads the sheet and records nothing. A sanction's step, Set
 * score, the ending prompt and Match details' Close and dim take no tap in the bounce window of appearing (`justShown`).
 */
export function usePadSheets(
  pad: PadSheetDriver,
  snapshot: PadSheetSnapshot | null,
  record: Recording,
  refuseScore: () => void,
) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const tool = useCallback((id: string) => setSheet(sheetFor(id)), []);
  const details = useCallback(() => setSheet(DETAILS), []);
  const history = useCallback(() => setSheet(HISTORY), []);
  const view = useMemo(() => sheetView(sheet, snapshot), [sheet, snapshot]);
  const justShown = useJustShown(guardedStep(sheet, view));
  const dismiss = useCallback(() => {
    if (!justShown()) cancel();
  }, [justShown, cancel]);
  const choose = useChoose(sheet, setSheet, snapshot?.display ?? null, record, justShown, pad);
  // No pad to put a sheet over (the match is loading, or is a state of its own): no sheet stays open behind it. And the
  // question is the only sheet over the pad while it stands (its confirm aside), and its confirm goes with it.
  if (sheet !== null && staleSheet(sheet, snapshot)) setSheet(null);
  const saveScore = useSaveScore(pad, record, refuseScore, cancel, justShown);
  // Discard asks again before it deletes: quiet in the bounce window of the question appearing (`justShown`).
  const askDiscard = useCallback(() => {
    if (!justShown()) setSheet(DISCARD);
  }, [justShown]);
  const actions = useMemo(
    () => ({ tool, details, history, choose, cancel, dismiss, saveScore, askDiscard }),
    [tool, details, history, choose, cancel, dismiss, saveScore, askDiscard],
  );
  return { open: sheet !== null, cancel, actions, view, justShown };
}

/** A sanction step's choice: the next step, or the sanction recorded (`Recording`) and the sheet closed. */
function useChoose(
  sheet: Sheet,
  setSheet: SetSheet,
  display: BadmintonDisplay | null,
  record: Recording,
  justShown: () => boolean,
  pad: PadSheetDriver,
) {
  const sides = display?.sides;
  return useCallback(
    (id: string) => {
      if (sheet?.kind !== 'sanction' || sides === undefined || justShown()) return;
      const move = chooseSanction(sheet.step, id, sides);
      if (move.kind === 'step') return setSheet({ kind: 'sanction', step: move.step });
      setSheet(null);
      record('sanction', () => pad.sanction(move.sanction));
    },
    [sheet, setSheet, sides, record, justShown, pad],
  );
}

/**
 * The step on screen a double tap can reach, by name: a sanction's level, person or confirm; Set score (review I1); the
 * ending prompt, one step wherever it comes from (the confirm, an Undo of the ending, a return to the pad); Match
 * details, whose dim takes the second touch on its icon (review M2). Not History: its one button is not under its icon.
 */
function guardedStep(sheet: Sheet, view: PadSheetView | null): string | null {
  if (view?.kind === 'sanction' && sheet?.kind === 'sanction') return sheet.step.step;
  return view === null || view.kind === 'history' ? null : view.kind;
}

/**
 * Whether a tap now falls in the bounce window (`bounce.ts`) of the guarded step on screen appearing (the
 * coordinator's ruling, 2026-11-01). The second tap of a double tap on one step's button lands on the next step's, on
 * the same bottom edge, and ending a match is the costliest mistake on the pad: such a tap does nothing and says
 * nothing (the step still waits; the line is behind the dim). A step's time is the render it first shows in.
 */
function useJustShown(step: string | null): () => boolean {
  const { clock } = usePorts();
  const [shown, setShown] = useState(() => ({ step, at: clock().getTime() }));
  if (shown.step !== step) setShown({ step, at: clock().getTime() });
  return useCallback(
    () => shown.step !== null && isBounce(clock().getTime() - shown.at),
    [shown, clock],
  );
}

/**
 * Set score's two fields as typed: a field that is not a whole number is refused, as the pad refuses a bad score.
 * Quiet in the bounce window of the sheet appearing: the second touch of a double tap on the tool lands on Confirm.
 */
function useSaveScore(
  pad: PadSheetDriver,
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

/**
 * Whether the question is put now: it stands, and the scorer can answer it. Over every card but a dead link's (round 4,
 * item 4; the controller's ruling, 2026-11-03): under a view-only match, a match not yet started or a recorded result the
 * taps are still queued and the scorer must still choose, while a dead link takes both answers away and the question is
 * moot there (the runner says so).
 */
const asking = (snapshot: PadSheetSnapshot): boolean =>
  (snapshot.ask ?? null) !== null && snapshot.card?.kind !== 'linkInvalid';

/** Whether an open sheet has no place now: no pad under it; the question over it; or its confirm with no question left. */
function staleSheet(sheet: NonNullable<Sheet>, snapshot: PadSheetSnapshot | null): boolean {
  if (snapshot === null) return true;
  return asking(snapshot) ? sheet.kind !== 'discard' : sheet.kind === 'discard';
}

function sheetFor(id: string): Sheet {
  const parsed = parseBadmintonTool(id);
  if (parsed === null) return null;
  return parsed.kind === 'sanction'
    ? { kind: 'sanction', step: startSanction(parsed.side) }
    : { kind: 'setScore' };
}

function sheetView(sheet: Sheet, snapshot: PadSheetSnapshot | null): PadSheetView | null {
  if (snapshot === null) return null;
  const { display, history, card, ask = null } = snapshot;
  // The reconnect question stands over everything while it stands (nothing is sent until it is answered), and its
  // confirm over it, a card or none.
  if (ask !== null && asking(snapshot)) {
    return { kind: sheet?.kind === 'discard' ? 'discard' : 'ask', ask };
  }
  // Under a card the pad takes no tap (`withCard`): the ending prompt goes with the tools while the ending waits, and is
  // back on the pad (hardening, 2026-11-01). Match details and History still open under the card.
  if (display.awaitingEnding && card === null) {
    return { kind: 'ending', person: disqualified(display) };
  }
  if (sheet === null) return null;
  if (sheet.kind === 'history') {
    return { kind: 'history', groups: history };
  }
  if (sheet.kind === 'sanction') {
    return { kind: 'sanction', sheet: sanctionSheet(sheet.step, display.sides) };
  }
  if (sheet.kind === 'details') return { kind: 'details', details: badmintonDetails(display) };
  return {
    kind: 'setScore',
    game: display.game,
    names: [sideNames(display.sides.first), sideNames(display.sides.second)],
    points: [display.points.first, display.points.second],
  };
}

/** The person whose disqualification waits for its ending: the last sanction recorded. */
function disqualified(display: BadmintonDisplay): string {
  return display.sanctions[display.sanctions.length - 1]?.person ?? '';
}
