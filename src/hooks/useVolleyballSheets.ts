import { useCallback, useMemo, useState } from 'react';
import type { PadOutcome } from '@/domain/scoring/padLine';
import type {
  PadHistoryGroup,
  PadMatchDetails,
  PadSide,
  PadText,
  PadVar,
} from '@/domain/scoring/padView';
import { sideNames } from '@/domain/scoring/setBasedSides';
import type { SanctionOption } from '@/domain/scoring/setBasedSanction';
import { volleyballDetails, volleyballServingTitle } from '@/domain/scoring/volleyballPad';
import type { VolleyballPeople } from '@/domain/scoring/volleyballPeople';
import {
  chooseSanction,
  sanctionSheet,
  startSanction,
  type SanctionStep,
} from '@/domain/scoring/volleyballSanction';
import { chooseSub, startSub, subSheet, type SubStep } from '@/domain/scoring/volleyballSub';
import {
  parseVolleyballTool,
  volleyballMoreOptions,
  volleyballSetScoreOffered,
  volleyballTools,
} from '@/domain/scoring/volleyballTools';
import type {
  VolleyballDisplay,
  VolleyballPadKey,
  VolleyballTap,
} from '@/domain/scoring/volleyballTypes';
import {
  askedView,
  staleByAsk,
  useJustShown,
  useSaveScore,
  type AskFacts,
  type AskView,
  type Recording,
} from '@/hooks/usePadSheetParts';

/**
 * The sheets over the volleyball pad (S2-6 Task 9; spec §4, §5, rulings 178, 180, 182, 185, 187): Timeout's and Sub's side
 * choice, Sub's off and on, More with Sanction's steps in its place, Who serves first?, Set score, Match details,
 * History, and the reconnect question over them all. Table tennis's twin is `useTableTennisSheets`; what the sports share
 * (the bounce window of a sheet appearing, Set score's fields, the question) is `usePadSheetParts`.
 */

type SubTap = Extract<VolleyballTap, { readonly kind: 'sub' }>;
type SanctionTap = Extract<VolleyballTap, { readonly kind: 'sanction' }>;

/** What each button of a sheet asks the match to do, and what it came to at once. */
export type VolleyballSheetDriver = {
  /** A sheet that lists people opened (Sub, More): the match reads its team sheets again (`usePeopleSheet`). */
  readonly peopleSheet: () => void;
  readonly timeout: (side: PadSide) => PadOutcome;
  readonly sub: (tap: SubTap) => PadOutcome;
  readonly sanction: (tap: SanctionTap) => PadOutcome;
  readonly setScore: (first: number, second: number) => PadOutcome;
  /** Holds the answer to Who serves first? for the next point (mid-set); no tap is made. */
  readonly serving: (side: PadSide) => PadOutcome;
  /** The deciding set's toss: the rally the scorer tapped, carrying the answer (ruling 180). */
  readonly toss: (serving: PadSide, tapped: PadSide) => PadOutcome;
};

/** What the sheets are drawn from: the display, History as grouped for the sheet, the people and the question. */
export type VolleyballSheetSnapshot = AskFacts & {
  readonly display: VolleyballDisplay;
  readonly history: readonly PadHistoryGroup<VolleyballPadKey>[];
  readonly people: VolleyballPeople;
};

/** A sheet of choices as `StepSheetView` draws it: a title, what is already chosen (or none), and the choices. */
export type StepFacts = {
  readonly title: PadText<VolleyballPadKey>;
  readonly body: PadVar<VolleyballPadKey> | null;
  readonly options: readonly SanctionOption<VolleyballPadKey>[];
};

/** What is over the pad. Every step kind is a step sheet whose choice goes back as an id. */
export type VolleyballSheetView =
  | { readonly kind: 'side'; readonly sheet: StepFacts }
  | { readonly kind: 'sub'; readonly sheet: StepFacts }
  | { readonly kind: 'more'; readonly sheet: StepFacts }
  | { readonly kind: 'sanction'; readonly sheet: StepFacts }
  | { readonly kind: 'serving'; readonly sheet: StepFacts }
  | { readonly kind: 'toss'; readonly sheet: StepFacts }
  | {
      readonly kind: 'setScore';
      /** The set it sets, the one the strip names: "Set score · Set 2". */
      readonly game: number;
      readonly names: readonly [string, string];
      readonly points: readonly [number, number];
      readonly bound: number;
    }
  | { readonly kind: 'details'; readonly details: PadMatchDetails<VolleyballPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<VolleyballPadKey>[] }
  | AskView;

type Sheet =
  | { readonly kind: 'side'; readonly for: 'timeout' | 'sub' }
  | { readonly kind: 'sub'; readonly step: SubStep }
  | { readonly kind: 'more' }
  | { readonly kind: 'sanction'; readonly step: SanctionStep }
  | { readonly kind: 'serving' }
  | { readonly kind: 'toss'; readonly tapped: PadSide }
  | { readonly kind: 'setScore' }
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | null;

const TIMEOUT_SIDE: Sheet = { kind: 'side', for: 'timeout' };
const SUB_SIDE: Sheet = { kind: 'side', for: 'sub' };
const MORE: Sheet = { kind: 'more' };
const SERVING: Sheet = { kind: 'serving' };
const SET_SCORE: Sheet = { kind: 'setScore' };
const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };

type SetSheet = (sheet: Sheet) => void;

/**
 * The sheet over the volleyball pad: a tool, a first tap at a toss, Match details or History opens one; a step moves
 * through it; Cancel, Close and Back close it. A step, a choice or Set score takes no tap in the bounce window of
 * appearing (`justShown`). `record` is the bounce memory's (`useTaps`' `opening`): a choice that records leaves the sheet
 * with it.
 */
export function useVolleyballSheets(
  pad: VolleyballSheetDriver,
  snapshot: VolleyballSheetSnapshot | null,
  record: Recording,
  refuseScore: () => void,
) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const { peopleSheet } = pad;
  const open = useCallback(
    (next: Sheet, listsPeople: boolean) => {
      if (listsPeople) peopleSheet();
      setSheet(next);
    },
    [peopleSheet],
  );
  const tool = useCallback((id: string) => open(sheetFor(id), listsPeople(id)), [open]);
  const toss = useCallback((tapped: PadSide) => setSheet({ kind: 'toss', tapped }), []);
  const details = useCallback(() => setSheet(DETAILS), []);
  const history = useCallback(() => setSheet(HISTORY), []);
  const view = useMemo(() => sheetView(sheet, snapshot), [sheet, snapshot]);
  const justShown = useJustShown(guardedStep(sheet, view));
  const dismiss = useCallback(() => {
    if (!justShown()) cancel();
  }, [justShown, cancel]);
  const choose = useChoose(sheet, setSheet, snapshot, record, justShown, pad);
  // No pad to put a sheet over, the question over it, or nothing left for it to do: no sheet stays open behind it.
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
  return { open: sheet !== null, cancel, actions, view, justShown, toss };
}

/** A choice on the sheet open. */
function useChoose(
  sheet: Sheet,
  setSheet: SetSheet,
  snapshot: VolleyballSheetSnapshot | null,
  record: Recording,
  justShown: () => boolean,
  pad: VolleyballSheetDriver,
) {
  return useCallback(
    (id: string) => {
      if (sheet === null || snapshot === null || justShown()) return;
      const { display, people } = snapshot;
      switch (sheet.kind) {
        case 'side':
          return chooseSide(sheet.for, id, people, setSheet, record, pad);
        case 'sub':
          return chooseOnSub(sheet.step, id, people, setSheet, record, pad);
        case 'more':
          return chooseOnMore(id, display, setSheet);
        case 'sanction':
          return chooseOnSanction(sheet.step, id, people, setSheet, record, pad);
        case 'serving':
          return chooseServing(id, setSheet, record, (side) => pad.serving(side), 'serving');
        case 'toss':
          return chooseServing(
            id,
            setSheet,
            record,
            (side) => pad.toss(side, sheet.tapped),
            'toss',
          );
      }
    },
    [sheet, setSheet, snapshot, record, justShown, pad],
  );
}

/** Timeout's side is recorded at once; Sub's goes on to who comes off (or records the side alone: no players). */
function chooseSide(
  of: 'timeout' | 'sub',
  id: string,
  people: VolleyballPeople,
  setSheet: SetSheet,
  record: Recording,
  pad: VolleyballSheetDriver,
): void {
  const side = sideOf(id);
  if (side === null) return;
  if (of === 'timeout') {
    setSheet(null);
    return void record('timeout', () => pad.timeout(side));
  }
  const move = startSub(side, people);
  if (move.kind === 'step') return setSheet({ kind: 'sub', step: move.step });
  setSheet(null);
  record('sub', () => pad.sub(move.tap));
}

function chooseOnSub(
  step: SubStep,
  id: string,
  people: VolleyballPeople,
  setSheet: SetSheet,
  record: Recording,
  pad: VolleyballSheetDriver,
): void {
  const move = chooseSub(step, id, people);
  if (move.kind === 'step') return setSheet({ kind: 'sub', step: move.step });
  setSheet(null);
  record('sub', () => pad.sub(move.tap));
}

/**
 * The More sheet's item: a Sanction for a side, opening its steps in More's place. An item is taken only while More still
 * lists it for the display as it is now: the sheet was drawn before, and the match may have stopped recording it since.
 */
function chooseOnMore(id: string, display: VolleyballDisplay, setSheet: SetSheet): void {
  const item = volleyballMoreOptions(display).find((option) => option.id === id);
  if (item === undefined) return;
  setSheet({
    kind: 'sanction',
    step: startSanction(item.id === 'sanction.first' ? 'first' : 'second'),
  });
}

function chooseOnSanction(
  step: SanctionStep,
  id: string,
  people: VolleyballPeople,
  setSheet: SetSheet,
  record: Recording,
  pad: VolleyballSheetDriver,
): void {
  const move = chooseSanction(step, id, people);
  if (move.kind === 'step') return setSheet({ kind: 'sanction', step: move.step });
  setSheet(null);
  record('sanction', () => pad.sanction(move.tap));
}

/**
 * The answer to Who serves first?, through the bounce memory, so a second touch records once. That the pad still needs
 * one is the sheet's own rule (`staleSheet`) and the held answer's (`put` takes none once the engine names a server).
 */
function chooseServing(
  id: string,
  setSheet: SetSheet,
  record: Recording,
  answer: (side: PadSide) => PadOutcome,
  tap: 'serving' | 'toss',
): void {
  const side = sideOf(id);
  if (side === null) return;
  setSheet(null);
  record(tap, () => answer(side));
}

/** The side a choice names: its id is the half, as the Start screen's. */
function sideOf(id: string): PadSide | null {
  return id === 'first' || id === 'second' ? id : null;
}

function sheetFor(id: string): Sheet {
  const parsed = parseVolleyballTool(id);
  if (parsed === null) return null;
  if ('setScore' in parsed) return SET_SCORE;
  if ('timeout' in parsed) return TIMEOUT_SIDE;
  if ('sub' in parsed) return SUB_SIDE;
  if ('more' in parsed) return MORE;
  return SERVING;
}

/** Sub and More list people (a sub's off and on, a sanction's person): opening them asks for the teams again (ruling 181). */
function listsPeople(id: string): boolean {
  const parsed = parseVolleyballTool(id);
  return parsed !== null && ('sub' in parsed || 'more' in parsed);
}

/**
 * The step on screen a double tap can reach, by name: a step's own name (Off, On, the level, the person), the side
 * choices, More, Who serves first?, Set score, Match details and the question. Not History: its one button is not under
 * its icon.
 */
function guardedStep(sheet: Sheet, view: VolleyballSheetView | null): string | null {
  if (view === null || view.kind === 'history') return null;
  if (sheet?.kind === 'sub' || sheet?.kind === 'sanction')
    return `${sheet.kind}.${sheet.step.step}`;
  return view.kind;
}

/** Whether an open sheet has no place now: the question's rules, or what it was for is gone. */
function staleSheet(sheet: NonNullable<Sheet>, snapshot: VolleyballSheetSnapshot | null): boolean {
  if (snapshot === null || staleByAsk(sheet.kind, snapshot)) return true;
  const { display } = snapshot;
  const offers = (id: string) => volleyballTools(display).some((tool) => tool.id === id);
  switch (sheet.kind) {
    case 'side':
      return !offers(sheet.for);
    case 'sub':
      return !offers('sub');
    case 'more':
    case 'sanction':
      return !offers('more');
    case 'serving':
    case 'toss':
      return !display.anchorNeeded;
    case 'setScore':
      return !volleyballSetScoreOffered(display);
    default:
      return false;
  }
}

function sheetView(
  sheet: Sheet,
  snapshot: VolleyballSheetSnapshot | null,
): VolleyballSheetView | null {
  if (snapshot === null) return null;
  // The reconnect question stands over everything while it stands, and its confirm over it, a card or none.
  const asked = askedView(sheet?.kind, snapshot);
  if (asked !== null) return asked;
  if (sheet === null) return null;
  const { display, people } = snapshot;
  switch (sheet.kind) {
    case 'side':
      return { kind: 'side', sheet: sideSheet(sheet.for, display) };
    case 'sub':
      return { kind: 'sub', sheet: subSheet(sheet.step, people, display.sides) };
    case 'more':
      return { kind: 'more', sheet: moreSheet(display) };
    case 'sanction':
      return { kind: 'sanction', sheet: sanctionSheet(sheet.step, people, display.sides) };
    case 'serving':
      return { kind: 'serving', sheet: servingSheet(display) };
    case 'toss':
      return { kind: 'toss', sheet: servingSheet(display) };
    case 'setScore':
      return setScoreView(display);
    case 'details':
      return { kind: 'details', details: volleyballDetails(display) };
    case 'history':
      return { kind: 'history', groups: snapshot.history };
    case 'discard':
      return null;
  }
}

/** The two sides, top first, as the Start screen's toss names them: the names as typed. */
function sideOptions(display: VolleyballDisplay): readonly SanctionOption<VolleyballPadKey>[] {
  return (['first', 'second'] as const).map((side) => ({
    id: side,
    label: sideNames(display.sides[side]),
    tone: 'standard',
  }));
}

function sideSheet(of: 'timeout' | 'sub', display: VolleyballDisplay): StepFacts {
  return {
    title: {
      key: of === 'timeout' ? 'scoring.volleyball.sheet.timeout' : 'scoring.volleyball.sheet.sub',
    },
    body: null,
    options: sideOptions(display),
  };
}

function moreSheet(display: VolleyballDisplay): StepFacts {
  return {
    title: { key: 'scoring.volleyball.tool.more' },
    body: null,
    options: volleyballMoreOptions(display).map(({ id, label }) => ({
      id,
      label,
      tone: 'standard',
    })),
  };
}

/** "Who serves first in set 5?": the set it is asked for, the two sides as choices. */
function servingSheet(display: VolleyballDisplay): StepFacts {
  return {
    title: volleyballServingTitle(display.set),
    body: null,
    options: sideOptions(display),
  };
}

function setScoreView(display: VolleyballDisplay): VolleyballSheetView {
  return {
    kind: 'setScore',
    game: display.set,
    names: [sideNames(display.sides.first), sideNames(display.sides.second)],
    points: [display.points.first, display.points.second],
    bound: display.rules.scoreBound,
  };
}
