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
import {
  chooseCard,
  cardSheet,
  startCard,
  type CardKey,
  type CardStep,
  type TableTennisCard,
} from '@/domain/scoring/tableTennisSanction';
import {
  parseTableTennisTool,
  tableTennisDetails,
  tableTennisMoreItems,
  tableTennisMoreOptions,
  type TableTennisDisplay,
  type TableTennisMoreItem,
  type TableTennisPadKey,
} from '@/domain/scoring/tableTennisPad';
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
 * The sheets over the table tennis pad (plan S2-2 Task 7; design §4.7, §5.3): the Card steps, More, Who is serving?, Set
 * score, Match details and History, and the reconnect question over them all. Badminton's twin is `usePadSheets`; what
 * the two share (the bounce window of a sheet appearing, Set score's fields, the question) is `usePadSheetParts`.
 */

/** What each button of a sheet asks the match to do, and what it came to at once. */
export type TableTennisSheetDriver = {
  readonly card: (card: TableTennisCard) => PadOutcome;
  readonly timeout: (side: PadSide) => PadOutcome;
  readonly expedite: () => PadOutcome;
  readonly setScore: (first: number, second: number) => PadOutcome;
  /** Holds the answer to Who is serving? for the next point (design §4.2); no tap is made. */
  readonly serving: (side: PadSide) => PadOutcome;
};

/** What the sheets are drawn from: the display, History as grouped for the sheet, and the card and question over the pad. */
export type TableTennisSheetSnapshot = AskFacts & {
  readonly display: TableTennisDisplay;
  readonly history: readonly PadHistoryGroup<TableTennisPadKey>[];
};

/** A sheet of choices as `StepSheet` draws it: a title, what is already chosen (or none), and the choices. */
export type StepFacts = {
  readonly title: PadText<CardKey>;
  readonly body: PadVar<CardKey> | null;
  readonly options: readonly SanctionOption<CardKey>[];
};

/**
 * What is over the pad: a Card step, the More sheet, Who is serving?, the Set score fields, Match details or History (a
 * cover the full height of the pad), or the reconnect question and its confirm over all of them.
 */
export type TableTennisSheetView =
  | { readonly kind: 'card'; readonly sheet: StepFacts }
  | { readonly kind: 'more'; readonly sheet: StepFacts }
  | { readonly kind: 'serving'; readonly sheet: StepFacts }
  | {
      readonly kind: 'setScore';
      /** The game it sets, the one the strip names: "Set score · Game 2". */
      readonly game: number;
      readonly names: readonly [string, string];
      readonly points: readonly [number, number];
      /** The most either field may hold: the engine's bound for this match's rules (`TableTennisRules.scoreBound`). */
      readonly bound: number;
    }
  | { readonly kind: 'details'; readonly details: PadMatchDetails<TableTennisPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<TableTennisPadKey>[] }
  | AskView;

type Sheet =
  | { readonly kind: 'card'; readonly step: CardStep }
  | { readonly kind: 'more' }
  | { readonly kind: 'serving' }
  | { readonly kind: 'setScore' }
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | null;

const MORE: Sheet = { kind: 'more' };
const SERVING: Sheet = { kind: 'serving' };
const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };

type SetSheet = (sheet: Sheet) => void;

/**
 * The sheet over the table tennis pad: a tool, Match details or History opens one, a Card's steps move through it, Cancel,
 * Close and Back close it. A step, a choice or Set score takes no tap in the bounce window of appearing (`justShown`): the
 * second touch of a double tap on a tool lands on the sheet's first choice, on the same bottom edge. `record` is the bounce
 * memory's (`useTaps`' `opening`): a choice that records leaves the sheet with it.
 */
export function useTableTennisSheets(
  pad: TableTennisSheetDriver,
  snapshot: TableTennisSheetSnapshot | null,
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
  const serve = useServe(setSheet, record, pad);
  const choose = useChoose(
    sheet,
    setSheet,
    snapshot?.display ?? null,
    record,
    justShown,
    pad,
    serve,
  );
  // No pad to put a sheet over (the match is loading, or is a state of its own), the question over it, or nothing left for
  // it to do: no sheet stays open behind it.
  if (sheet !== null && staleSheet(sheet, snapshot)) setSheet(null);
  const saveScore = useSaveScore(pad, record, refuseScore, cancel, justShown);
  const pickServing = useCallback(
    (side: PadSide) => {
      if (!justShown()) serve(side);
    },
    [justShown, serve],
  );
  // Discard asks again before it deletes: quiet in the bounce window of the question appearing (`justShown`).
  const askDiscard = useCallback(() => {
    if (!justShown()) setSheet(DISCARD);
  }, [justShown]);
  const actions = useMemo(
    () => ({
      tool,
      details,
      history,
      choose,
      pickServing,
      cancel,
      dismiss,
      saveScore,
      askDiscard,
    }),
    [tool, details, history, choose, pickServing, cancel, dismiss, saveScore, askDiscard],
  );
  return { open: sheet !== null, cancel, actions, view, justShown };
}

/** The answer to Who is serving?: held for the next point (`TableTennisSheetDriver.serving`), through the bounce memory. */
function useServe(setSheet: SetSheet, record: Recording, pad: TableTennisSheetDriver) {
  return useCallback(
    (side: PadSide) => {
      setSheet(null);
      record('serving', () => pad.serving(side));
    },
    [setSheet, record, pad],
  );
}

/** A choice on the sheet open: the Card's next step or the card recorded, a More item, or a side for the serve. */
function useChoose(
  sheet: Sheet,
  setSheet: SetSheet,
  display: TableTennisDisplay | null,
  record: Recording,
  justShown: () => boolean,
  pad: TableTennisSheetDriver,
  serve: (side: PadSide) => void,
) {
  return useCallback(
    (id: string) => {
      if (sheet === null || display === null || justShown()) return;
      if (sheet.kind === 'card')
        return chooseOnCard(sheet.step, id, display, setSheet, record, pad);
      if (sheet.kind === 'more') return chooseOnMore(id, setSheet, record, pad);
      const side = sideOf(id);
      if (sheet.kind === 'serving' && side !== null) serve(side);
    },
    [sheet, setSheet, display, record, justShown, pad, serve],
  );
}

function chooseOnCard(
  step: CardStep,
  id: string,
  display: TableTennisDisplay,
  setSheet: SetSheet,
  record: Recording,
  pad: TableTennisSheetDriver,
): void {
  const move = chooseCard(step, id, display.sides);
  if (move.kind === 'step') return setSheet({ kind: 'card', step: move.step });
  setSheet(null);
  record('sanction', () => pad.card(move.card));
}

/** The More sheet's item: a timeout or Expedite recorded at once, Set score opening its own sheet in More's place. */
function chooseOnMore(
  id: string,
  setSheet: SetSheet,
  record: Recording,
  pad: TableTennisSheetDriver,
): void {
  const item = MORE_ITEMS.find((each) => each === id);
  if (item === undefined) return;
  if (item === 'setScore') return setSheet({ kind: 'setScore' });
  setSheet(null);
  if (item === 'expedite') record('expedite', () => pad.expedite());
  else record('timeout', () => pad.timeout(item === 'timeout.first' ? 'first' : 'second'));
}

/** Every item the More sheet can list (`tableTennisMoreItems`); a choice outside it is nobody's. */
const MORE_ITEMS: readonly TableTennisMoreItem[] = [
  'timeout.first',
  'timeout.second',
  'expedite',
  'setScore',
];

/** The side a serving choice names: its id is the half, as the Start screen's. */
function sideOf(id: string): PadSide | null {
  return id === 'first' || id === 'second' ? id : null;
}

/**
 * The step on screen a double tap can reach, by name: a Card's level or person; More; Who is serving?; Set score; Match
 * details, whose dim takes the second touch on its icon; the question and its confirm. Not History: its one button is not
 * under its icon.
 */
function guardedStep(sheet: Sheet, view: TableTennisSheetView | null): string | null {
  if (view?.kind === 'card' && sheet?.kind === 'card') return sheet.step.step;
  return view === null || view.kind === 'history' ? null : view.kind;
}

/** Whether an open sheet has no place now: the question's rules (`staleByAsk`), or what it was for is gone. */
function staleSheet(sheet: NonNullable<Sheet>, snapshot: TableTennisSheetSnapshot | null): boolean {
  if (snapshot === null || staleByAsk(sheet.kind, snapshot)) return true;
  const { display } = snapshot;
  if (sheet.kind === 'serving') return !display.anchorNeeded;
  return sheet.kind === 'more' && tableTennisMoreItems(display).length === 0;
}

function sheetFor(id: string): Sheet {
  const parsed = parseTableTennisTool(id);
  if (parsed === null) return null;
  if ('card' in parsed) return { kind: 'card', step: startCard(parsed.card) };
  if ('more' in parsed) return MORE;
  return 'serving' in parsed ? SERVING : null;
}

function sheetView(
  sheet: Sheet,
  snapshot: TableTennisSheetSnapshot | null,
): TableTennisSheetView | null {
  if (snapshot === null) return null;
  // The reconnect question stands over everything while it stands (nothing is sent until it is answered), and its
  // confirm over it, a card or none.
  const asked = askedView(sheet?.kind, snapshot);
  if (asked !== null) return asked;
  if (sheet === null) return null;
  const { display } = snapshot;
  switch (sheet.kind) {
    case 'card':
      return { kind: 'card', sheet: cardSheet(sheet.step, display.sides) };
    case 'more':
      return { kind: 'more', sheet: moreSheet(display) };
    case 'serving':
      return { kind: 'serving', sheet: servingSheet(display) };
    case 'setScore':
      return setScoreView(display);
    case 'details':
      return { kind: 'details', details: tableTennisDetails(display) };
    case 'history':
      return { kind: 'history', groups: snapshot.history };
    case 'discard':
      return null;
  }
}

function moreSheet(display: TableTennisDisplay): StepFacts {
  return {
    title: { key: 'scoring.tabletennis.tool.more' },
    body: null,
    options: tableTennisMoreOptions(display).map(({ id, label }) => ({
      id,
      label,
      tone: 'standard',
    })),
  };
}

/** The two sides as the Start screen's toss does, top first: the names as typed. */
function servingSheet(display: TableTennisDisplay): StepFacts {
  return {
    title: { key: 'scoring.tabletennis.tool.serving' },
    body: null,
    options: (['first', 'second'] as const).map((side) => ({
      id: side,
      label: sideNames(display.sides[side]),
      tone: 'standard',
    })),
  };
}

function setScoreView(display: TableTennisDisplay): TableTennisSheetView {
  return {
    kind: 'setScore',
    game: display.game,
    names: [sideNames(display.sides.first), sideNames(display.sides.second)],
    points: [display.points.first, display.points.second],
    bound: display.rules.scoreBound,
  };
}
