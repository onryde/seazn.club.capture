import { useCallback, useMemo, useState } from 'react';
import { footballBoard, footballTakesCorrect } from '@/domain/scoring/footballBoard';
import {
  footballChoose,
  footballOpen,
  footballStep,
  footballStepName,
  MORE_FLOW,
  type FootballFlow,
  type FootballMove,
  type FootballStepSheet,
} from '@/domain/scoring/footballSheet';
import type { FootballDisplay, FootballPadKey, FootballTap } from '@/domain/scoring/footballTypes';
import { TAKEN, refusing, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadHistoryGroup, PadMatchDetails } from '@/domain/scoring/padView';
import type { FootballClockRead } from '@/hooks/useFootballClock';
import {
  askedView,
  staleByAsk,
  useJustShown,
  type AskFacts,
  type AskView,
  type Recording,
} from '@/hooks/usePadSheetParts';
import type { Arm } from '@/hooks/usePadTaps';

/**
 * The sheets over the football pad (S2-5 design §6.3–§6.6, §7.5; plan P Task 11): a column's or More's steps, which record
 * nothing until their last step (`footballSheet.ts` says what each step offers), Correct, Match details, History, and the
 * reconnect question over them all. A press captures the clock's stamp when it is pressed, and the step's last choice
 * records one tap with it; Cancel, the dim and Back record nothing (ruling 106). Chess's twin is `useChessSheets`.
 */

/** What a sheet's last step asks the match to do, and what it came to at once. */
export type FootballSheetDriver = {
  readonly tap: (made: FootballTap) => PadOutcome;
  /** Correct's Set: the clock set to `elapsed`, running or stopped as it is. */
  readonly correct: (elapsed: number) => PadOutcome;
};

/** What the sheets are drawn from: the display, Match details and History as the pad has them, and the question. */
export type FootballSheetSnapshot = AskFacts & {
  readonly display: FootballDisplay;
  readonly details: PadMatchDetails<FootballPadKey>;
  readonly history: readonly PadHistoryGroup<FootballPadKey>[];
};

/** A move of Correct's steppers, in seconds (design §7.5). */
export type ClockDelta = -60 | -10 | 10 | 60;

/** What is over the pad. */
export type FootballSheetView =
  | { readonly kind: 'step'; readonly sheet: FootballStepSheet }
  /** Correct: the move from the reading now, and whether a step back would go before the last event. */
  | { readonly kind: 'correct'; readonly deltaSeconds: number; readonly atFloor: boolean }
  | { readonly kind: 'details'; readonly details: PadMatchDetails<FootballPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<FootballPadKey>[] }
  | AskView;

/**
 * A step sheet remembers the phase it opened in and the column button that opened it (none for More): it closes when the
 * phase moves or that button is disabled. Correct remembers its move and its phase.
 */
type Sheet =
  | {
      readonly kind: 'step';
      readonly flow: FootballFlow;
      readonly phase: string;
      readonly column: string | null;
    }
  | { readonly kind: 'correct'; readonly delta: number; readonly phase: string }
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | null;

const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };

const NOT_NOW: PadOutcome = refusing('notNow');

/** The names a sheet's last step and close have in the bounce memory. */
const STEP_TAP = 'step';
const CORRECT_TAP = 'correct';
const CLOSE_TAP = 'close';

export function useFootballSheets(
  driver: FootballSheetDriver,
  snapshot: FootballSheetSnapshot | null,
  clock: FootballClockRead,
  record: Recording,
  arm: Arm,
) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const view = useMemo(() => sheetView(sheet, snapshot, clock), [sheet, snapshot, clock]);
  const justShown = useJustShown(guardedStep(sheet, view));
  // No match to put a sheet over, the question over it, or nothing left for it to do: no sheet stays open behind it.
  if (sheet !== null && staleSheet(sheet, snapshot)) setSheet(null);
  const parts: Parts = { sheet, setSheet, snapshot, clock, justShown, driver, record, arm, cancel };
  const opens = useOpens(parts);
  const steps = useSteps(parts);
  const correct = useCorrect(parts);
  return {
    open: sheet !== null,
    cancel,
    view,
    justShown,
    actions: useMemo(() => ({ ...opens, ...steps, ...correct }), [opens, steps, correct]),
  };
}

type SetSheet = (sheet: Sheet) => void;

type Parts = {
  readonly sheet: Sheet;
  readonly setSheet: SetSheet;
  readonly snapshot: FootballSheetSnapshot | null;
  readonly clock: FootballClockRead;
  readonly justShown: () => boolean;
  readonly driver: FootballSheetDriver;
  readonly record: Recording;
  readonly arm: Arm;
  readonly cancel: () => void;
};

/** Whether a sheet may open over the pad now: a match under it, and no question standing over it. */
const openable = (snapshot: FootballSheetSnapshot | null): snapshot is FootballSheetSnapshot =>
  snapshot !== null && !staleByAsk('step', snapshot);

/**
 * What opens a sheet: a column's button (its first step, or for a team with no sheet its tap at once), More, Correct from
 * the clock's face, Match details, History and the question's Discard. Each answers what it came to, for the bounce memory.
 */
function useOpens({ setSheet, snapshot, clock, justShown, driver }: Parts) {
  const column = useCallback(
    (id: string): PadOutcome => {
      // A disabled button takes no press; one that went off under the finger opens a sheet the render closes at once
      // (`staleSheet`), or a tap the runtime refuses.
      if (!openable(snapshot)) return NOT_NOW;
      const move = footballOpen(id, snapshot.display, clock.stampNow());
      return opened(move, snapshot, id, setSheet, driver);
    },
    [snapshot, clock, setSheet, driver],
  );
  // More and Correct open over a standing question too, and the render closes them at once (`staleSheet`): a column's
  // button checks first, since a team with no sheet records at once.
  const more = useCallback((): PadOutcome => {
    if (snapshot === null) return NOT_NOW;
    return opened({ kind: 'flow', flow: MORE_FLOW }, snapshot, null, setSheet, driver);
  }, [snapshot, setSheet, driver]);
  const correct = useCallback((): PadOutcome => {
    if (snapshot === null || !footballTakesCorrect(snapshot.display)) return NOT_NOW;
    setSheet({ kind: 'correct', delta: 0, phase: snapshot.display.enginePhase });
    return TAKEN;
  }, [snapshot, setSheet]);
  const details = useCallback(() => setSheet(DETAILS), [setSheet]);
  const history = useCallback(() => setSheet(HISTORY), [setSheet]);
  // Discard asks again before it deletes: quiet in the bounce window of the question appearing.
  const askDiscard = useCallback(() => {
    if (snapshot !== null && !justShown()) setSheet(DISCARD);
  }, [snapshot, justShown, setSheet]);
  return useMemo(
    () => ({ column, more, openCorrect: correct, details, history, askDiscard }),
    [column, more, correct, details, history, askDiscard],
  );
}

/** A move made from the pad: a step shown over it, or the tap made at once. */
function opened(
  move: FootballMove,
  snapshot: FootballSheetSnapshot,
  column: string | null,
  setSheet: SetSheet,
  driver: FootballSheetDriver,
): PadOutcome {
  if (move.kind === 'tap') return driver.tap(move.tap);
  if (move.kind !== 'flow') return NOT_NOW;
  setSheet({ kind: 'step', flow: move.flow, phase: snapshot.display.enginePhase, column });
  return TAKEN;
}

/**
 * A choice on the step on screen, and the sheet's own close. A choice in the bounce window of its step appearing is the
 * second touch of a double tap and does nothing. The last step leaves the sheet through the bounce memory (`record`), so
 * a double tap there counts once; Cancel and the dim arm the same window on the way out (`arm`), and Back (`cancel`) is
 * not a touch on the pad.
 */
function useSteps({
  sheet,
  setSheet,
  snapshot,
  clock,
  justShown,
  record,
  arm,
  cancel,
  driver,
}: Parts) {
  const choose = useCallback(
    (id: string) => {
      if (sheet?.kind !== 'step' || snapshot === null || justShown()) return;
      const move = footballChoose(sheet.flow, id, snapshot.display, clock.stampNow());
      if (move.kind === 'flow') return setSheet({ ...sheet, flow: move.flow });
      if (move.kind === 'tap') {
        setSheet(null);
        record(STEP_TAP, () => driver.tap(move.tap));
        return;
      }
      if (move.kind === 'other') {
        const phase = snapshot.display.enginePhase;
        setSheet(move.id === 'details' ? DETAILS : { kind: 'correct', delta: 0, phase });
      }
    },
    [sheet, setSheet, snapshot, clock, justShown, record, driver],
  );
  const dismiss = useCallback(() => {
    if (justShown()) return;
    arm(CLOSE_TAP);
    cancel();
  }, [justShown, arm, cancel]);
  return useMemo(() => ({ choose, dismiss }), [choose, dismiss]);
}

/**
 * Correct's steppers and Set (design §7.5): the move is held here, the time is the reading now plus the move, and a step
 * back stops at the last event's stamp in this period (the floor the web would refuse below). Set records one clock event
 * at that time, running or stopped as the clock is.
 */
function useCorrect({ sheet, setSheet, snapshot, clock, justShown, record, driver }: Parts) {
  const step = useCallback(
    (delta: ClockDelta) => {
      if (sheet?.kind !== 'correct' || snapshot === null || justShown()) return;
      const lowest = floorOf(snapshot.display) - clock.readingNow();
      setSheet({ ...sheet, delta: Math.max(sheet.delta + delta, lowest) });
    },
    [sheet, setSheet, snapshot, clock, justShown],
  );
  const set = useCallback(() => {
    if (sheet?.kind !== 'correct' || snapshot === null || justShown()) return;
    // Below the floor only if the floor moved since the last step: the queue raises such a stamp to it (§7.3, `restamp`).
    const elapsed = clock.readingNow() + sheet.delta;
    setSheet(null);
    record(CORRECT_TAP, () => driver.correct(elapsed));
  }, [sheet, setSheet, snapshot, clock, justShown, record, driver]);
  return useMemo(() => ({ step, set }), [step, set]);
}

/** The last event's stamp in the period in play: no clock event may be set before it. */
export function floorOf(display: FootballDisplay): number {
  const { asOf } = display.clock;
  return asOf !== null && asOf.period === display.enginePhase ? asOf.elapsed : 0;
}

/** Whether a column's button is live now (`footballBoard`): a disabled one opens nothing and closes its open sheet. */
function columnEnabled(snapshot: FootballSheetSnapshot, id: string): boolean {
  const { columns } = footballBoard(snapshot.display, snapshot.card);
  return columns.some((column) =>
    column.actions.some((action) => action.id === id && action.enabled),
  );
}

/**
 * Whether an open sheet has no place now: the question's rules (`staleByAsk`), or what it was for is gone. A step sheet and
 * Correct were for the period they opened in; a step sheet opened by a column's button, for that button while it is live.
 */
function staleSheet(sheet: NonNullable<Sheet>, snapshot: FootballSheetSnapshot | null): boolean {
  if (snapshot === null || staleByAsk(sheet.kind, snapshot)) return true;
  if (sheet.kind !== 'step' && sheet.kind !== 'correct') return false;
  if (snapshot.display.enginePhase !== sheet.phase) return true;
  return sheet.kind === 'step' && sheet.column !== null && !columnEnabled(snapshot, sheet.column);
}

/**
 * The step on screen a double tap can reach, by name: each step of a step sheet (a choice moves it to the next, whose rows
 * lie under the same finger), Correct, Match details and the question. Not History: its one button is not under its icon.
 */
function guardedStep(sheet: Sheet, view: FootballSheetView | null): string | null {
  if (view === null || view.kind === 'history') return null;
  if (sheet?.kind === 'step' && view.kind === 'step') return footballStepName(sheet.flow);
  return view.kind;
}

function sheetView(
  sheet: Sheet,
  snapshot: FootballSheetSnapshot | null,
  clock: FootballClockRead,
): FootballSheetView | null {
  if (snapshot === null) return null;
  // The reconnect question stands over everything while it stands (nothing is sent until it is answered), and its
  // confirm over it, a card or none.
  const asked = askedView(sheet?.kind, snapshot);
  if (asked !== null) return asked;
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'step':
      return { kind: 'step', sheet: footballStep(sheet.flow, snapshot.display) };
    case 'correct': {
      const atFloor = clock.readingNow() + sheet.delta <= floorOf(snapshot.display);
      return { kind: 'correct', deltaSeconds: sheet.delta, atFloor };
    }
    case 'details':
      return { kind: 'details', details: snapshot.details };
    case 'history':
      return { kind: 'history', groups: snapshot.history };
    case 'discard':
      return null;
  }
}
