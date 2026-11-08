import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NO_RESYNC, resyncStep } from '@/domain/scoring/footballResync';
import { footballSport } from '@/domain/scoring/footballSport';
import type {
  FootballDisplay,
  FootballPadKey,
  FootballTypes,
} from '@/domain/scoring/footballTypes';
import { refusing, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import type { RunnerSnapshot, ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useFootballClock, type FootballClockRead } from '@/hooks/useFootballClock';
import {
  useFootballSheets,
  type ClockDelta,
  type FootballSheetDriver,
  type FootballSheetSnapshot,
  type FootballSheetView,
} from '@/hooks/useFootballSheets';
import { useAskActions, useClosedByDeadLink, useStartActions } from '@/hooks/usePadMatchParts';
import { useSettle, useTaps, type PadTapDriver } from '@/hooks/usePadTaps';
import { usePorts, type Ports } from '@/hooks/usePorts';
import { useLinks, useScoringMatch, useSender, type MatchSender } from '@/hooks/useScoringMatch';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';

/**
 * A football match on the pad screen (S2-5 design §6, §7; plan P Task 11): the generic match (`useScoringMatch`) with
 * football's pad hook. What is football's here: the columns' buttons and More open step sheets that record nothing until
 * their last step (`useFootballSheets`), the clock's Start and Pause and its Correct, End of period, the resync after a
 * Start accepted late (ruling 2), and an Undo that passes a resync (ruling 9). Football has no serve: Start match starts
 * at once.
 */

/** Football's own buttons, beside every pad's (`PadActions`). */
export type FootballPadActions = PadActions & {
  /** Start match, with no pick; `pickServer` is the kit's unused picker. */
  readonly start: () => void;
  readonly pickServer: (side: PadSide) => void;
  /** A column's button (`goal.first`): its sheet, or for a team with no team sheet its tap at once. */
  readonly column: (id: string) => void;
  /** The clock bar's Start or Pause. */
  readonly clock: () => void;
  /** A tap on the clock's time: Correct. */
  readonly correct: () => void;
  /** A choice on the step sheet on screen. */
  readonly choose: (id: string) => void;
  /** Correct's steppers and Set. */
  readonly step: (delta: ClockDelta) => void;
  readonly set: () => void;
  /** A sheet's Cancel and dim: quiet in the bounce window of the sheet appearing, and arming it on the way out. */
  readonly cancelSheet: () => void;
  /** The reconnect question (owner ruling 43): Send my taps, Discard them (which asks again) and its confirm's Discard. */
  readonly sendTaps: () => void;
  readonly askDiscard: () => void;
  readonly confirmDiscard: () => void;
};

/** What the football pad screen is drawn from. */
export type FootballPadModel = PadScreenModel<FootballPadKey, FootballSheetView> & {
  readonly display: FootballDisplay;
  /** The Start screen's pick of a side: football has none to make. */
  readonly toss: PadSide | null;
  /** The clock's reading now, in whole seconds of the period: the screen's clock leaf reads it on its own tick. */
  readonly readingNow: () => number;
  readonly actions: FootballPadActions;
};

export function useFootballMatch(fixtureId: string): ScoringMatch<FootballPadModel> {
  return useScoringMatch(fixtureId, footballSport, useFootballPad);
}

type PadFacts = MatchPad<FootballTypes>;
type Sender = MatchSender<FootballTypes>;

/**
 * The session record's lines (plan P Task 9's spec, keys on the allow-list): a clock tap, `{action: start | pause | correct
 * | resync, phase}`, and a period ended, `{phase: <its marker>}`. Never a person, a name or an id.
 */
export const CLOCK_EVENT = 'scoring.football.clock';
export const PERIOD_EVENT = 'scoring.football.period';

/** Football flashes no half: its taps are buttons in a column, not a half tapped. */
const ignoreFlash = (): void => undefined;

const NOTHING_TO_UNDO: PadOutcome = refusing('nothingToUndo');
const NOT_NOW: PadOutcome = refusing('notNow');

function useFootballPad(
  ports: Ports,
  runner: ScoringRunner | null,
  pad: PadFacts | null,
): FootballPadModel | null {
  const sender = useSender<FootballTypes>(ports, runner);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const display = pad?.display ?? null;
  const clock = useFootballClock(display);
  const settle = useSettle(sender.say);
  const driver = useFootballDriver(sender, display, clock);
  const taps = useTaps(driver, settle, sender.say, ignoreFlash);
  useResync(ports, runner, sender, display?.enginePhase ?? '');
  const sheets = useSheets(ports, sender, taps, pad, clock);
  const actions = useActions({ ports, sender, runner, pad, taps, sheets, clock, setCardNote });
  useBackCloses(sheets.open, sheets.cancel);
  useClosedInBackground(sheets.open, sheets.cancel);
  return useMemo(
    () => modelOf(pad, sheets.view, cardNote, clock, actions),
    [pad, sheets.view, cardNote, clock, actions],
  );
}

/** What the screen is drawn from, or none while the match is loading. */
function modelOf(
  pad: PadFacts | null,
  sheet: FootballSheetView | null,
  cardNote: MessageKey | null,
  clock: FootballClockRead,
  actions: FootballPadActions,
): FootballPadModel | null {
  if (pad === null) return null;
  return {
    kind: 'pad',
    view: pad.view,
    sheet,
    line: pad.line,
    cardNote,
    flash: null,
    display: pad.display,
    toss: pad.toss,
    readingNow: clock.readingNow,
    actions,
  };
}

/**
 * The taps the bounce memory drives. Football has no half to tap. Undo passes a resync (ruling 9): with the running Start
 * under it the two are taken back together, the resync first; with another tap under it, that tap is taken back and the
 * clock is re-anchored at the reading Undo was pressed at, so every screen still reads the clock right.
 */
function useFootballDriver(
  sender: Sender,
  display: FootballDisplay | null,
  clock: FootballClockRead,
): PadTapDriver {
  // The sender refuses an Undo the runtime has no target for (`undoTarget`), the same judgement as `undoable`: a refused
  // first Undo refuses the second too, on the same state.
  const undo = useCallback((): PadOutcome => {
    if (display === null) return NOTHING_TO_UNDO;
    if (display.undoPlan === 'plain') return sender.undo();
    const reading = clock.readingNow();
    sender.undo();
    const under = sender.undo();
    if (display.undoPlan === 'pastResync' && under.ok) {
      sender.tap({ kind: 'clock', running: true, elapsed: reading });
    }
    return under;
  }, [sender, display, clock]);
  return useMemo(() => ({ rally: () => NOT_NOW, undo }), [undo]);
}

const LOADING: RunnerSnapshot = { kind: 'loading' };
const noSubscribe = (): (() => void) => () => undefined;
const loading = (): RunnerSnapshot => LOADING;

/**
 * The resync after a Start accepted late (ruling 2): the watch (`resyncStep`) over every state the runner publishes, at
 * the phone's time then. Each Start is decided once (its memory is this mount's); a resync is tapped like any clock tap
 * and said in the record. A runner that dies first makes none (ruling 10).
 */
function useResync(
  ports: Ports,
  runner: ScoringRunner | null,
  sender: Sender,
  phase: string,
): void {
  const snapshot = useSyncExternalStore(
    runner?.subscribe ?? noSubscribe,
    runner?.snapshot ?? loading,
  );
  const memory = useRef(NO_RESYNC);
  const { clock, logger } = ports;
  const { tap } = sender;
  useEffect(() => {
    if (snapshot.kind !== 'ready') return;
    const stepped = resyncStep(memory.current, snapshot.state, clock().getTime());
    memory.current = stepped.memory;
    for (const made of stepped.taps) {
      if (tap(made).ok) logger.info(CLOCK_EVENT, { action: 'resync', phase });
    }
    // A new phase runs the watch again over the same state: each Start is decided once, so it asks for nothing again.
  }, [snapshot, clock, logger, tap, phase]);
}

/** The sheets over the pad, closed at once when the link dies, since the bad-link card then shows. */
function useSheets(
  ports: Ports,
  sender: Sender,
  taps: ReturnType<typeof useTaps>,
  pad: PadFacts | null,
  clock: FootballClockRead,
) {
  const { tap } = sender;
  const { logger } = ports;
  const driver = useMemo<FootballSheetDriver>(
    () => ({
      tap,
      correct: (elapsed) => {
        const running = pad?.display.clock.anchor?.running === true;
        const outcome = tap({ kind: 'clock', running, elapsed });
        const phase = pad?.display.enginePhase ?? '';
        if (outcome.ok) logger.info(CLOCK_EVENT, { action: 'correct', phase });
        return outcome;
      },
    }),
    [tap, logger, pad],
  );
  const snapshot = useMemo<FootballSheetSnapshot | null>(
    () =>
      pad === null
        ? null
        : {
            display: pad.display,
            details: pad.view.details,
            history: pad.history,
            card: pad.view.card,
            ask: pad.ask,
          },
    [pad],
  );
  const sheets = useFootballSheets(driver, snapshot, clock, taps.opening, taps.arm);
  useClosedByDeadLink(pad?.view, sheets.open, sheets.cancel);
  return sheets;
}

/** A sheet goes with the app to the background (brief test 15): a choice left open on a locked phone is stale when it comes back. */
function useClosedInBackground(open: boolean, cancel: () => void): void {
  const { foreground } = usePorts();
  useEffect(() => {
    if (!open) return;
    return foreground.subscribeBackground(cancel);
  }, [foreground, open, cancel]);
}

type Parts = {
  readonly ports: Ports;
  readonly sender: Sender;
  readonly runner: ScoringRunner | null;
  readonly pad: PadFacts | null;
  readonly taps: ReturnType<typeof useTaps>;
  readonly sheets: ReturnType<typeof useSheets>;
  readonly clock: FootballClockRead;
  readonly setCardNote: (note: MessageKey | null) => void;
};

function useActions(parts: Parts): FootballPadActions {
  const { taps, sheets } = parts;
  const home = useBackToHome();
  const start = useStart(parts);
  const asked = useAskActions(
    parts.sender.answer,
    taps.opening,
    sheets.justShown,
    sheets.actions.askDiscard,
  );
  const links = useLinks(parts.runner, parts.setCardNote);
  const pressing = usePressing(parts);
  const { cancel } = sheets;
  const { undo } = taps;
  const { choose, step, set, dismiss, details, history } = sheets.actions;
  return useMemo(
    () => ({
      home,
      undo,
      cancel,
      choose,
      step,
      set,
      dismiss,
      cancelSheet: dismiss,
      details,
      history,
      tapHalf: ignoreHalf,
      ...pressing,
      ...asked,
      ...links,
      ...start,
    }),
    [
      home,
      undo,
      cancel,
      choose,
      step,
      set,
      dismiss,
      details,
      history,
      pressing,
      asked,
      links,
      start,
    ],
  );
}

/** Football has no half to tap: the columns' buttons are the pad. */
const ignoreHalf = (): void => undefined;

/** Start match is a tap with no side (football has no serve), through the bounce memory; the kit's picker is never drawn. */
function useStart({ sender, runner, pad, taps }: Parts) {
  const { tap } = sender;
  const startWith = useCallback(() => tap({ kind: 'start' }), [tap]);
  // The literal `false` is load-bearing: it is what makes Start match start at once, with no pick (S2-3 Task 2).
  return useStartActions(runner, pad?.toss ?? null, startWith, taps.opening, false);
}

/** The opening taps' names in the bounce memory: a repeat of one counts once, and so does any tap on the heels of it. */
const COLUMN_TAP = 'column';
const CLOCK_TAP = 'clock';
const CORRECT_TAP = 'openCorrect';
const MORE_TAP = 'more';
const PERIOD_TAP = 'period';

/** The tool cells' ids, as the pad names them (`footballPad.ts`). */
const PERIOD_TOOL = 'period';
const MORE_TOOL = 'more';

/**
 * What a column's button, the clock bar and a tool do. Each is an opening tap (`useTaps`): the second touch of a double
 * tap counts once, and so does any tap on the heels of a sheet's recording. Start and Pause read the clock when pressed;
 * End of period stamps the reading too.
 */
function usePressing({ ports, sender, pad, taps, sheets, clock }: Parts) {
  const { opening } = taps;
  const { tap } = sender;
  const { logger } = ports;
  const sheetActions = sheets.actions;
  const column = useCallback(
    (id: string) => void opening(COLUMN_TAP, () => sheetActions.column(id)),
    [opening, sheetActions],
  );
  const running = pad?.display.clock.anchor?.running === true;
  const phase = pad?.display.enginePhase ?? '';
  const startPause = useCallback(
    () =>
      void opening(CLOCK_TAP, () => {
        const outcome = tap({ kind: 'clock', running: !running, elapsed: clock.readingNow() });
        const action = running ? 'pause' : 'start';
        if (outcome.ok) logger.info(CLOCK_EVENT, { action, phase });
        return outcome;
      }),
    [opening, tap, running, phase, clock, logger],
  );
  const marker = pad?.display.marker ?? null;
  const endPeriod = useCallback((): PadOutcome => {
    const outcome = tap({ kind: 'period', stamp: clock.stampNow() });
    if (outcome.ok && marker !== null) logger.info(PERIOD_EVENT, { phase: marker });
    return outcome;
  }, [tap, clock, marker, logger]);
  const tool = useCallback(
    (id: string) => {
      if (id === PERIOD_TOOL) void opening(PERIOD_TAP, endPeriod);
      else if (id === MORE_TOOL) void opening(MORE_TAP, sheetActions.more);
    },
    [opening, endPeriod, sheetActions],
  );
  const correct = useCallback(
    () => void opening(CORRECT_TAP, sheetActions.openCorrect),
    [opening, sheetActions],
  );
  return useMemo(
    () => ({ column, clock: startPause, tool, correct }),
    [column, startPause, tool, correct],
  );
}
