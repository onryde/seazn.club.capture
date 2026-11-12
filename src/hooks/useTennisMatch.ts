import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { refusalLine, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide, PadView } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import { tennisPeopleOf, violationDone, type TennisPeople } from '@/domain/scoring/tennisSanction';
import { tennisSport } from '@/domain/scoring/tennisSport';
import type { TennisDisplay, TennisPadKey, TennisTypes } from '@/domain/scoring/tennisTypes';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import type { RunnerSnapshot, ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useAskActions, useClosedByDeadLink, usePeopleSheet } from '@/hooks/usePadMatchParts';
import {
  START_TAP,
  useGuardedTool,
  useSettle,
  useTaps,
  type PadTapDriver,
} from '@/hooks/usePadTaps';
import type { Ports } from '@/hooks/usePorts';
import { useLinks, useScoringMatch, useSender, type MatchSender } from '@/hooks/useScoringMatch';
import { useBackToHome } from '@/hooks/useStreamLinks';
import {
  useTennisSheets,
  type TennisSheetDriver,
  type TennisSheetSnapshot,
  type TennisSheetView,
} from '@/hooks/useTennisSheets';
import type { MessageKey } from '@/i18n/messages';

/**
 * A tennis match on the pad screen (S2-7 Task 9): the generic match (`useScoringMatch`) with tennis's pad hook, as
 * `useVolleyballMatch` is volleyball's. What is tennis's here: a half is a point, and Start asks who serves first (ruling 233)
 * and queues the toss before the start; Violation, Break, Award game and Set score open sheets (`useTennisSheets`), and a sheet that lists
 * people asks the match to read its teams again; a violation's consequence (the point or the game the scorer taps next) is
 * said in the last-tap line (ruling 218). There is no ending prompt: the organiser's endings are the web's (ruling 225).
 */

/** Tennis's own buttons, beside every pad's (`PadActions`). */
export type TennisPadActions = PadActions & {
  /** A choice on the sheet open: a side, a level, a player, a kind or a confirm. */
  readonly choose: (id: string) => void;
  /** Back from a step of a sheet to the step before; from its first step, it closes. */
  readonly back: () => void;
  /** Set score's Save: the games, then (for a tie-break set) the tie-break's points. */
  readonly saveScore: (first: string, second: string) => void;
  /** The Start screen: the pick of who serves first (ruling 233), then Start match, which queues the toss before the start. */
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
  /** The reconnect question (owner ruling 43): Send my taps, Discard them (which asks again) and its confirm's Discard. */
  readonly sendTaps: () => void;
  readonly askDiscard: () => void;
  readonly confirmDiscard: () => void;
};

/** What the tennis pad screen is drawn from. */
export type TennisPadModel = PadScreenModel<TennisPadKey, TennisSheetView> & {
  /** The Start screen's pick of who serves first; none until the scorer picks, and none once the match starts. */
  readonly toss: PadSide | null;
  readonly actions: TennisPadActions;
};

export function useTennisMatch(fixtureId: string): ScoringMatch<TennisPadModel> {
  return useScoringMatch(fixtureId, tennisSport, useTennisPad);
}

type PadFacts = MatchPad<TennisTypes>;
type Sender = MatchSender<TennisTypes>;

function useTennisPad(
  ports: Ports,
  runner: ScoringRunner | null,
  pad: PadFacts | null,
): TennisPadModel | null {
  const sender = useSender<TennisTypes>(ports, runner);
  const [flash, setFlash] = useState<HalfFlash>(null);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const settle = useSettle(sender.say);
  const undoStart = useUndoWithToss(sender, pad?.display, ports.logger);
  const driver = useMemo<PadTapDriver>(
    () => ({
      rally: (side) => sender.tap({ kind: 'point', side }),
      undo: undoStart,
    }),
    [sender, undoStart],
  );
  const taps = useTaps(driver, settle, sender.say, setFlash);
  const people = usePeople(runner);
  const sheets = useSheets(ports, runner, sender, taps.opening, pad, people);
  const actions = useActions({ sender, runner, pad, taps, sheets, setCardNote });
  useBackCloses(sheets.open, sheets.back);
  const view = useMemo(
    () => (pad === null ? null : withViolationNote(pad.view, pad.display)),
    [pad],
  );
  return useMemo(
    () =>
      pad === null || view === null
        ? null
        : {
            kind: 'pad',
            view,
            sheet: sheets.view,
            line: pad.line,
            cardNote,
            flash,
            toss: pad.toss,
            actions,
          },
    [pad, view, sheets.view, cardNote, flash, actions],
  );
}

/**
 * Undo, which takes the toss under the start with it (ruling 233): the Start screen then asks who serves first again. A toss
 * left held would stay, since the engine takes one and the Start screen has no Undo, so the scorer who picked the wrong side
 * could never pick again. The toss's Undo follows once the start's has taken effect (the match shows the Start screen), never
 * in the same breath: a start whose fate is unknown is voided when its answer comes, and the toss waits for that. Whose toss it
 * is, is the match's to judge as it is for every Undo (`undoTarget`): another scorer's toss is not this phone's to void, and
 * an Undo with nothing of ours to take back is refused and changes nothing.
 */
function useUndoWithToss(
  sender: Sender,
  display: TennisDisplay | undefined,
  logger: Ports['logger'],
): () => PadOutcome {
  const startIsLast = display?.lastTap?.kind === 'start';
  const [owed, setOwed] = useState(false);
  const undo = useCallback((): PadOutcome => {
    const outcome = sender.undo();
    // Owed only when the start's Undo was taken: a refused one (a race with another scorer's tap) leaves the toss alone.
    if (startIsLast && outcome.ok) setOwed(true);
    return outcome;
  }, [sender, startIsLast]);
  const due = owed && display?.phase === 'notStarted';
  useEffect(() => {
    if (!due) return;
    setOwed(false);
    if (!sender.undo().ok) logger.warn('scoring.toss-undo-refused');
  }, [due, sender, logger]);
  return undo;
}

/**
 * After a violation whose consequence is the scorer's to tap (a point penalty gives the other side the point, a game
 * penalty the game: ruling 218), that line stands in the last tap's place; a warning says nothing more than the tap did.
 */
function withViolationNote(
  view: PadView<TennisPadKey>,
  display: TennisDisplay,
): PadView<TennisPadKey> {
  const last = display.lastTap;
  if (
    last === null ||
    last.kind !== 'violation' ||
    last.level === 'default' ||
    view.lastTap === null
  )
    return view;
  const text = violationDone(last.level, last.side, display);
  return text === null ? view : { ...view, lastTap: { ...view.lastTap, text } };
}

const NOBODY: TennisPeople = { first: [], second: [] };

/** The people the sheets list: the bootstrap's team sheets as the match holds them now, read again when a sheet asks. */
function usePeople(runner: ScoringRunner | null): TennisPeople {
  const snapshot = useSyncExternalStore(
    runner?.subscribe ?? noSubscribe,
    runner?.snapshot ?? loading,
  );
  const bootstrap = snapshot.kind === 'ready' ? snapshot.state.bootstrap : null;
  return useMemo(() => (bootstrap === null ? NOBODY : tennisPeopleOf(bootstrap)), [bootstrap]);
}

const noSubscribe = (): (() => void) => () => undefined;
const LOADING: RunnerSnapshot = { kind: 'loading' };
const loading = (): RunnerSnapshot => LOADING;

/**
 * The sheets over the pad: what each button asks of the match, as taps (a violation, an award, a break, a set's score).
 * Closed at once when the link dies, since the bad-link card then shows. A sheet another scorer's point overtook says one
 * line and the record one (never silent: AGENTS §10, failure class 3).
 */
function useSheets(
  ports: Ports,
  runner: ScoringRunner | null,
  sender: Sender,
  opening: ReturnType<typeof useTaps>['opening'],
  pad: PadFacts | null,
  people: TennisPeople,
) {
  const { tap, say } = sender;
  const peopleSheet = usePeopleSheet(runner);
  const { logger } = ports;
  const driver = useMemo<TennisSheetDriver>(
    () => ({
      peopleSheet,
      violation: tap,
      award: tap,
      interruption: tap,
      setScore: (first, second, tb) => tap({ kind: 'setScore', first, second, tb }),
      movedOn: (sheet) => {
        say(refusalLine('scoring.refusal.notCounted'));
        logger.warn('scoring.sheet-dropped', { reason: 'moved-on', sheet });
      },
    }),
    [peopleSheet, tap, say, logger],
  );
  const refuseScore = useCallback(() => say(refusalLine('scoring.refusal.invalidScore')), [say]);
  const snapshot = useMemo<TennisSheetSnapshot | null>(
    () =>
      pad === null
        ? null
        : { display: pad.display, history: pad.history, card: pad.view.card, ask: pad.ask, people },
    [pad, people],
  );
  const sheets = useTennisSheets(driver, snapshot, opening, refuseScore);
  useClosedByDeadLink(pad?.view, sheets.open, sheets.cancel);
  return sheets;
}

type Parts = {
  readonly sender: Sender;
  readonly runner: ScoringRunner | null;
  readonly pad: PadFacts | null;
  readonly taps: ReturnType<typeof useTaps>;
  readonly sheets: ReturnType<typeof useSheets>;
  readonly setCardNote: (note: MessageKey | null) => void;
};

function useActions(parts: Parts): TennisPadActions {
  const { taps, sheets, sender, runner, pad } = parts;
  const home = useBackToHome();
  const { pickServer, start } = useStart(runner, sender, pad, taps.opening);
  const asked = useAskActions(
    sender.answer,
    taps.opening,
    sheets.justShown,
    sheets.actions.askDiscard,
  );
  const links = useLinks(runner, parts.setCardNote);
  const tool = useGuardedTool(taps.secondTouch, sheets.actions.tool);
  const { tapHalf, undo } = taps;
  return useMemo(
    () => ({
      home,
      tapHalf,
      undo,
      ...sheets.actions,
      tool,
      ...asked,
      ...links,
      pickServer,
      start,
    }),
    [home, tapHalf, undo, tool, sheets.actions, asked, links, pickServer, start],
  );
}

/**
 * The Start screen's actions (ruling 233; the controller's rulings 1 and 3). With a serve to pick, Start match waits for the
 * pick and then queues `tennis.toss` BEFORE `core.start`, both from the one action: a toss queued after the start with
 * nothing scored would count as play (ruling 112) and block a walkover. With a toss already held (another scorer's, or
 * this phone's), there is nothing to ask and Start match sends the start alone. The toss is judged against the match as it
 * is when the tap lands (`tennisEventFor`), so a match another scorer started meanwhile refuses it and takes nothing over.
 */
function useStart(
  runner: ScoringRunner | null,
  sender: Sender,
  pad: PadFacts | null,
  opening: ReturnType<typeof useTaps>['opening'],
) {
  const toss = pad?.toss ?? null;
  const needsToss = pad?.view.start?.needsToss ?? false;
  const pickServer = useCallback(
    (side: PadSide) => void runner?.dispatch({ kind: 'pickServer', side }),
    [runner],
  );
  const start = useCallback(() => {
    if (!needsToss) opening(START_TAP, () => startWith(sender));
    else if (toss !== null) opening(START_TAP, () => startWith(sender, toss));
  }, [opening, sender, toss, needsToss]);
  return useMemo(() => ({ pickServer, start }), [pickServer, start]);
}

/** The toss (when there is a side) and then the start, as two taps of one action: the start's answer is the action's. */
function startWith(sender: Sender, server?: PadSide): PadOutcome {
  if (server !== undefined) sender.tap({ kind: 'toss', side: server });
  return sender.tap({ kind: 'start' });
}
