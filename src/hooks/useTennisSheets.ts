import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PadOutcome } from '@/domain/scoring/padLine';
import type { PadHistoryGroup, PadMatchDetails, PadSide, PadVar } from '@/domain/scoring/padView';
import type { SanctionSheet } from '@/domain/scoring/setBasedSanction';
import { sideNames } from '@/domain/scoring/setBasedSides';
import { tennisDetails } from '@/domain/scoring/tennisPad';
import { setScoreAsksTiebreak, setScoreBounds } from '@/domain/scoring/tennisSetScore';
import {
  awardSheet,
  backAward,
  backBreak,
  breakSheet,
  chooseAward,
  chooseBreak,
  startAward,
  startBreak,
  type AwardStep,
  type BreakStep,
} from '@/domain/scoring/tennisSteps';
import {
  backViolation,
  chooseViolation,
  startViolation,
  violationSheet,
  type TennisPeople,
  type ViolationStep,
} from '@/domain/scoring/tennisSanction';
import { parseTennisTool, tennisSetScoreOffered, tennisTools } from '@/domain/scoring/tennisTools';
import type { TennisDisplay, TennisPadKey, TennisTap } from '@/domain/scoring/tennisTypes';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';
import {
  askedView,
  staleByAsk,
  useJustShown,
  type AskFacts,
  type AskView,
  type Recording,
} from '@/hooks/usePadSheetParts';

/**
 * The sheets over the tennis pad (S2-7 Task 9; spec §4, rulings 218-221, 229): Violation's side, level, player and confirm,
 * Award game's side and confirm, Break's kind and side, Set score's games and, when they are a tie-break set's, its points,
 * Match details, History, and the reconnect question over them all. Volleyball's twin is `useVolleyballSheets`; what the sports
 * share (the bounce window of a sheet appearing, the question) is `usePadSheetParts`.
 *
 * Tennis holds no pick across taps (no toss, no serve question), so a sheet's answer goes with the tap that opens nothing
 * else: a sheet that takes a score records the match's score events when it opens, and when another scorer's point lands
 * while it is open it closes at once and sends nothing (spec §9 lesson 4; Review Focus 2). One line says so.
 */

type Tap<K extends TennisTap['kind']> = Extract<TennisTap, { readonly kind: K }>;

/** What each button of a sheet asks the match to do, and what it came to at once. */
export type TennisSheetDriver = {
  /** A sheet that lists people opened (Violation, Break): the match reads its team sheets again (`usePeopleSheet`). */
  readonly peopleSheet: () => void;
  readonly violation: (tap: Tap<'violation'>) => PadOutcome;
  readonly award: (tap: Tap<'award'>) => PadOutcome;
  readonly interruption: (tap: Tap<'break'>) => PadOutcome;
  readonly setScore: (
    first: number,
    second: number,
    tb: { readonly first: number; readonly second: number } | null,
  ) => PadOutcome;
  /** A sheet that takes a score closed because another scorer's point landed first: the pad says one line, the record one. */
  readonly movedOn: (sheet: string) => void;
};

/** What the sheets are drawn from: the display, History as grouped for the sheet, the people and the question. */
export type TennisSheetSnapshot = AskFacts & {
  readonly display: TennisDisplay;
  readonly history: readonly PadHistoryGroup<TennisPadKey>[];
  readonly people: TennisPeople;
};

/** A sheet of choices as `StepSheetView` draws it: a title, what is already chosen (or none), and the choices. */
export type TennisStepFacts = Omit<SanctionSheet<TennisPadKey>, 'body'> & {
  readonly body: PadVar<TennisPadKey> | null;
};

/** What is over the pad. Every step kind is a step sheet whose choice goes back as an id. */
export type TennisSheetView =
  | { readonly kind: 'side'; readonly sheet: TennisStepFacts }
  | { readonly kind: 'violation'; readonly sheet: TennisStepFacts }
  | { readonly kind: 'award'; readonly sheet: TennisStepFacts }
  | { readonly kind: 'break'; readonly sheet: TennisStepFacts }
  | {
      readonly kind: 'setScore';
      /** The set it sets, the one the strip names: "Set score · Set 2". */
      readonly set: number;
      /** Games first; the tie-break's points only for a tie-break set's games. */
      readonly stage: 'games' | 'tiebreak';
      readonly names: readonly [string, string];
      readonly bound: number;
    }
  | { readonly kind: 'details'; readonly details: PadMatchDetails<TennisPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<TennisPadKey>[] }
  | AskView;

type Sheet =
  | { readonly kind: 'side' }
  | { readonly kind: 'violation'; readonly step: ViolationStep }
  | { readonly kind: 'award'; readonly step: AwardStep }
  | { readonly kind: 'break'; readonly step: BreakStep }
  | {
      readonly kind: 'setScore';
      readonly stage: 'games' | 'tiebreak';
      /** The games already typed, once Set score has gone on to the tie-break's points. */
      readonly games: readonly [number, number] | null;
    }
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | null;

const SIDE: Sheet = { kind: 'side' };
const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };
const SET_SCORE: Sheet = { kind: 'setScore', stage: 'games', games: null };

type SetSheet = (sheet: Sheet) => void;

/** A sheet that takes a score: another scorer's point under it makes what it would record stale. */
const takesScore = (sheet: Sheet): boolean =>
  sheet !== null &&
  sheet.kind !== 'details' &&
  sheet.kind !== 'history' &&
  sheet.kind !== 'discard';

/** The count of score events a sheet opened at, or null while no sheet that takes a score is open. */
type Opened = number | null;

/**
 * The sheet over the tennis pad: a tool, Match details or History opens one; a step moves through it; Back steps back (the
 * first step closes it), Cancel, Close and the dim close it. A step or a choice takes no tap in the bounce window of
 * appearing (`justShown`). `record` is the bounce memory's (`useTaps`' `opening`): a choice that records leaves the sheet
 * with it.
 */
export function useTennisSheets(
  pad: TennisSheetDriver,
  snapshot: TennisSheetSnapshot | null,
  record: Recording,
  refuseScore: () => void,
) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [opened, setOpened] = useState<Opened>(null);
  const latest = useLatest(snapshot);
  const cancel = useCallback(() => setSheet(null), []);
  const { peopleSheet } = pad;
  const open = useCallback(
    (next: Sheet, listsPeople: boolean) => {
      if (listsPeople) peopleSheet();
      setOpened(takesScore(next) ? (latest.current?.display.scoreEvents ?? null) : null);
      setSheet(next);
    },
    [peopleSheet, latest],
  );
  const tool = useCallback((id: string) => open(sheetFor(id), listsPeople(id)), [open]);
  const details = useCallback(() => open(DETAILS, false), [open]);
  const history = useCallback(() => open(HISTORY, false), [open]);
  const movedOn = takesScore(sheet) && snapshot !== null && opened !== snapshot.display.scoreEvents;
  const view = useMemo(
    () => (movedOn ? null : sheetView(sheet, snapshot)),
    [movedOn, sheet, snapshot],
  );
  const justShown = useJustShown(guardedStep(sheet, view));
  const dismiss = useCallback(() => {
    if (!justShown()) cancel();
  }, [justShown, cancel]);
  // Another scorer's point landed under an open sheet: nothing it holds is recorded, and one line says so.
  const { movedOn: say } = pad;
  const kind = sheet?.kind;
  useEffect(() => {
    if (!movedOn || kind === undefined) return;
    setSheet(null);
    setOpened(null);
    say(kind);
  }, [movedOn, kind, say]);
  // No pad to put a sheet over, the question over it, or nothing left for it to do: no sheet stays open behind it.
  // (A sheet another scorer's point overtook is closed with its line by the effect above, not silently here.)
  if (sheet !== null && !movedOn && staleSheet(sheet, snapshot)) setSheet(null);
  const parts = { sheet, setSheet, latest, record, justShown, pad, opened };
  const choose = useChoose(parts);
  const back = useBack(parts, cancel);
  const saveScore = useSaveScore(parts, refuseScore);
  // Discard asks again before it deletes: quiet in the bounce window of the question appearing (`justShown`).
  const askDiscard = useCallback(() => {
    if (!justShown()) setSheet(DISCARD);
  }, [justShown]);
  const actions = useMemo(
    () => ({ tool, details, history, choose, back, cancel, dismiss, saveScore, askDiscard }),
    [tool, details, history, choose, back, cancel, dismiss, saveScore, askDiscard],
  );
  return { open: sheet !== null, cancel, back, actions, view, justShown };
}

/** The snapshot as the last render drew it, for a press that reaches a closure drawn before it. */
function useLatest(snapshot: TennisSheetSnapshot | null) {
  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  });
  return latest;
}

type Parts = {
  readonly sheet: Sheet;
  readonly setSheet: SetSheet;
  readonly latest: { readonly current: TennisSheetSnapshot | null };
  readonly record: Recording;
  readonly justShown: () => boolean;
  readonly pad: TennisSheetDriver;
  readonly opened: Opened;
};

/**
 * The snapshot a press may act on, or null: none, the bounce window of the sheet appearing, no sheet, or another scorer's
 * point since the sheet opened (the sheet is about to close and nothing it holds is sent).
 */
function actable({ sheet, latest, justShown, opened }: Parts): TennisSheetSnapshot | null {
  const snapshot = latest.current;
  if (sheet === null || snapshot === null || justShown()) return null;
  return takesScore(sheet) && opened !== snapshot.display.scoreEvents ? null : snapshot;
}

/** A choice on the sheet open. */
function useChoose(parts: Parts) {
  const { sheet, setSheet, record, pad, latest, justShown, opened } = parts;
  return useCallback(
    (id: string) => {
      const snapshot = actable({ sheet, setSheet, record, pad, latest, justShown, opened });
      if (snapshot === null || sheet === null) return;
      const { display, people } = snapshot;
      switch (sheet.kind) {
        case 'side':
          return chooseSide(id, setSheet);
        case 'violation': {
          const move = chooseViolation(sheet.step, id, display, people);
          if (move.kind === 'step') return setSheet({ kind: 'violation', step: move.step });
          setSheet(null);
          return void record('violation', () => pad.violation(move.tap));
        }
        case 'award': {
          const move = chooseAward(sheet.step, id);
          if (move.kind === 'step') return setSheet({ kind: 'award', step: move.step });
          setSheet(null);
          return void record('award', () => pad.award(move.tap));
        }
        case 'break': {
          const move = chooseBreak(sheet.step, id);
          if (move.kind === 'step') return setSheet({ kind: 'break', step: move.step });
          setSheet(null);
          return void record('break', () => pad.interruption(move.tap));
        }
      }
    },
    [sheet, setSheet, record, pad, latest, justShown, opened],
  );
}

/** Violation's side: its id is the half, as the Start screen's. */
function chooseSide(id: string, setSheet: SetSheet): void {
  if (id === 'first' || id === 'second') setSheet({ kind: 'violation', step: startViolation(id) });
}

/** Back steps back through a sheet's steps; from the first step (or a sheet with none) it closes the sheet. */
function useBack(parts: Parts, cancel: () => void) {
  const { sheet, setSheet, latest } = parts;
  return useCallback(() => {
    if (sheet === null) return;
    const display = latest.current?.display;
    const people = latest.current?.people;
    const back =
      display === undefined || people === undefined ? null : stepBack(sheet, display, people);
    if (back === null) return cancel();
    setSheet(back);
  }, [sheet, setSheet, latest, cancel]);
}

/** The sheet one step before this one, or null: the first step of one, or a sheet with a single step. */
function stepBack(sheet: NonNullable<Sheet>, display: TennisDisplay, people: TennisPeople): Sheet {
  switch (sheet.kind) {
    case 'violation': {
      const back = backViolation(sheet.step, display, people);
      return back === null ? SIDE : { kind: 'violation', step: back };
    }
    case 'award': {
      const back = backAward(sheet.step);
      return back === null ? null : { kind: 'award', step: back };
    }
    case 'break': {
      const back = backBreak(sheet.step);
      return back === null ? null : { kind: 'break', step: back };
    }
    case 'setScore':
      return sheet.stage === 'tiebreak' ? SET_SCORE : null;
    default:
      return null;
  }
}

/**
 * Set score's Save: the games first, and the tie-break's points when the games are a tie-break set's; a field that is not a
 * whole number is refused as the pad refuses a bad score. Quiet in the bounce window of the sheet appearing: the second touch
 * of a double tap on the tool lands on Confirm. The sheet closes before the fields are judged.
 */
function useSaveScore(parts: Parts, refuse: () => void) {
  const { sheet, setSheet, record, pad, latest, justShown, opened } = parts;
  return useCallback(
    (first: string, second: string) => {
      const snapshot = actable({ sheet, setSheet, record, pad, latest, justShown, opened });
      if (snapshot === null || sheet === null || sheet.kind !== 'setScore') return;
      const [top, bottom] = [parseWholeNumber(first), parseWholeNumber(second)];
      if (top === null || bottom === null) {
        setSheet(null);
        return refuse();
      }
      if (sheet.stage === 'games') {
        if (setScoreAsksTiebreak(snapshot.display, top, bottom))
          return setSheet({ kind: 'setScore', stage: 'tiebreak', games: [top, bottom] });
        setSheet(null);
        return void record('setScore', () => pad.setScore(top, bottom, null));
      }
      const games = sheet.games;
      setSheet(null);
      if (games === null) return refuse();
      record('setScore', () => pad.setScore(games[0], games[1], { first: top, second: bottom }));
    },
    [sheet, setSheet, record, pad, refuse, latest, justShown, opened],
  );
}

/** Violation lists a side's players and Break names its sides: opening them asks for the teams again (ruling 181). */
function listsPeople(id: string): boolean {
  const parsed = parseTennisTool(id);
  return parsed !== null && ('violation' in parsed || 'break' in parsed);
}

function sheetFor(id: string): Sheet {
  const parsed = parseTennisTool(id);
  if (parsed === null) return null;
  if ('violation' in parsed) return SIDE;
  if ('break' in parsed) return { kind: 'break', step: startBreak() };
  if ('award' in parsed) return { kind: 'award', step: startAward() };
  return SET_SCORE;
}

/**
 * The step on screen a double tap can reach, by name: a step's own name, the side choice, Set score, Match details and the
 * question. Not History: its one button is not under its icon.
 */
function guardedStep(sheet: Sheet, view: TennisSheetView | null): string | null {
  if (view === null || view.kind === 'history') return null;
  if (sheet?.kind === 'violation' || sheet?.kind === 'award' || sheet?.kind === 'break')
    return `${sheet.kind}.${sheet.step.step}`;
  if (sheet?.kind === 'setScore') return `setScore.${sheet.stage}`;
  return view.kind;
}

/** Whether an open sheet has no place now: the question's rules, or what it was for is gone. */
function staleSheet(sheet: NonNullable<Sheet>, snapshot: TennisSheetSnapshot | null): boolean {
  if (snapshot === null || staleByAsk(sheet.kind, snapshot)) return true;
  const { display } = snapshot;
  const offers = (id: string) =>
    tennisTools(display).some((tool) => tool.enabled && tool.id === id);
  switch (sheet.kind) {
    case 'side':
    case 'violation':
      return !offers('violation');
    case 'break':
      return !offers('break');
    case 'award':
      return !offers('award');
    case 'setScore':
      return !tennisSetScoreOffered(display);
    default:
      return false;
  }
}

function sheetView(sheet: Sheet, snapshot: TennisSheetSnapshot | null): TennisSheetView | null {
  if (snapshot === null) return null;
  // The reconnect question stands over everything while it stands, and its confirm over it, a card or none.
  const asked = askedView(sheet?.kind, snapshot);
  if (asked !== null) return asked;
  if (sheet === null) return null;
  const { display, people } = snapshot;
  switch (sheet.kind) {
    case 'side':
      return { kind: 'side', sheet: sideSheet(display) };
    case 'violation':
      return { kind: 'violation', sheet: violationSheet(sheet.step, display, people) };
    case 'award':
      return { kind: 'award', sheet: awardSheet(sheet.step, display) };
    case 'break':
      return { kind: 'break', sheet: breakSheet(sheet.step, display) };
    case 'setScore':
      return setScoreView(sheet, display);
    case 'details':
      return { kind: 'details', details: tennisDetails(display) };
    case 'history':
      return { kind: 'history', groups: snapshot.history };
    case 'discard':
      return null;
  }
}

/** Violation's first step: the two sides, top first, as the Start screen names them. */
function sideSheet(display: TennisDisplay): TennisStepFacts {
  return {
    title: { key: 'scoring.tennis.violation.title' },
    body: null,
    options: (['first', 'second'] as const).map((side: PadSide) => ({
      id: side,
      label: sideNames(display.sides[side]),
      tone: 'standard',
    })),
  };
}

function setScoreView(
  sheet: Extract<NonNullable<Sheet>, { readonly kind: 'setScore' }>,
  display: TennisDisplay,
): TennisSheetView {
  const bounds = setScoreBounds(display);
  return {
    kind: 'setScore',
    set: display.set,
    stage: sheet.stage,
    names: [sideNames(display.sides.first), sideNames(display.sides.second)],
    bound: sheet.stage === 'games' ? bounds.games : bounds.tiebreak,
  };
}
