import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { refusalLine } from '@/domain/scoring/padLine';
import type { PadView } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import { tennisPeopleOf, violationDone, type TennisPeople } from '@/domain/scoring/tennisSanction';
import { tennisSport } from '@/domain/scoring/tennisSport';
import type { TennisDisplay, TennisPadKey, TennisTypes } from '@/domain/scoring/tennisTypes';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import type { RunnerSnapshot, ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import {
  useAskActions,
  useClosedByDeadLink,
  usePeopleSheet,
  useStartActions,
} from '@/hooks/usePadMatchParts';
import { useGuardedTool, useSettle, useTaps, type PadTapDriver } from '@/hooks/usePadTaps';
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
 * `useVolleyballMatch` is volleyball's. What is tennis's here: a half is a point, with nothing to ask first (the engine names
 * the server, ruling 216); Violation, Break, Award game and Set score open sheets (`useTennisSheets`), and a sheet that lists
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
  /** The Start screen: Start match, a tap (there is no serve to pick, ruling 216). */
  readonly start: () => void;
  /** The reconnect question (owner ruling 43): Send my taps, Discard them (which asks again) and its confirm's Discard. */
  readonly sendTaps: () => void;
  readonly askDiscard: () => void;
  readonly confirmDiscard: () => void;
};

/** What the tennis pad screen is drawn from. */
export type TennisPadModel = PadScreenModel<TennisPadKey, TennisSheetView> & {
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
  const driver = useMemo<PadTapDriver>(
    () => ({
      rally: (side) => sender.tap({ kind: 'point', side }),
      undo: () => sender.undo(),
    }),
    [sender],
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
        : { kind: 'pad', view, sheet: sheets.view, line: pad.line, cardNote, flash, actions },
    [pad, view, sheets.view, cardNote, flash, actions],
  );
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
  const startWith = useCallback(() => sender.tap({ kind: 'start' }), [sender]);
  const { start } = useStartActions(runner, pad?.toss ?? null, startWith, taps.opening, false);
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
    () => ({ home, tapHalf, undo, ...sheets.actions, tool, ...asked, ...links, start }),
    [home, tapHalf, undo, tool, sheets.actions, asked, links, start],
  );
}
