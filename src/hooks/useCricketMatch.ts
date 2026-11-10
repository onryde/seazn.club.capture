import { useCallback, useEffect, useMemo, useState } from 'react';
import { runBall, type SheetExtra } from '@/domain/scoring/cricketExtras';
import { moreOffered } from '@/domain/scoring/cricketMore';
import { cricketBoard, type CricketBoardView } from '@/domain/scoring/cricketPad';
import { withPick, withoutStalePicks, type CricketPick } from '@/domain/scoring/cricketPicks';
import type { PlayersTab } from '@/domain/scoring/cricketPlayers';
import { cricketSport } from '@/domain/scoring/cricketSport';
import { totalsView, type CricketTotals, type TotalsOver } from '@/domain/scoring/cricketTotals';
import type {
  CricketDisplay,
  CricketPadKey,
  CricketStage,
  CricketTap,
  CricketTypes,
} from '@/domain/scoring/cricketTypes';
import { refusing, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { PendingPicks } from '@/domain/scoring/pendingPicks';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import type { ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import {
  useCricketSetup,
  type CricketSetupActions,
  type CricketSetupModel,
} from '@/hooks/useCricketSetup';
import {
  useCricketSheets,
  type CricketSheetSnapshot,
  type CricketSheetView,
} from '@/hooks/useCricketSheets';
import { useAskActions, useClosedByDeadLink, useStartActions } from '@/hooks/usePadMatchParts';
import { useSettle, useTaps, type PadTapDriver } from '@/hooks/usePadTaps';
import type { Ports } from '@/hooks/usePorts';
import { useLinks, useScoringMatch, useSender, type MatchSender } from '@/hooks/useScoringMatch';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';

/**
 * A cricket match on the pad screen (S2-4 plan Task 8): the generic match (`useScoringMatch`) with cricket's pad hook, as
 * `useChessMatch` is chess's, with the three actions every later task builds on: `record` queues a tap through the
 * runtime (a ball, the toss, Start), `setPicks` keeps the scorer's pending picks with the queue, and `undo` takes back
 * this phone's last standing tap. The board is the display's (`cricketBoard`); the halves are not drawn. Before the first
 * ball the setup stands in the board's place (`useCricketSetup`, Task 10).
 */

/** Cricket's own buttons, beside every pad's (`PadActions`) and the setup's (Task 10). Tasks 11 to 17 add theirs. */
export type CricketPadActions = PadActions &
  CricketSetupActions & {
    /** A tap to the match: once for a repeat of the same tap inside the bounce window, as every pad's tap. */
    readonly record: (tap: CricketTap) => void;
    /** The scorer's pending picks, the whole map: kept on the phone until a tap carries them. */
    readonly setPicks: (picks: PendingPicks) => void;
    /** The kit's Start screen's pick: cricket never shows it (its toss is its own), so this is never pressed. */
    readonly pickServer: (side: PadSide) => void;
    /** Start match, on the setup's last step: records `core.start`, once for a double tap, and nothing until it is ready. */
    readonly start: () => void;
    /** The reconnect question (owner ruling 43): Send my taps, Discard them (which asks again) and its confirm's Discard. */
    readonly sendTaps: () => void;
    readonly askDiscard: () => void;
    readonly confirmDiscard: () => void;
    /** A run key (0, 1, 2, 3, 4, 6): one ball, the 4 and 6 boundaries (Task 11). */
    readonly run: (runs: number) => void;
    /** An extra's key: its sheet, which asks the runs (ruling 80). */
    readonly openExtras: (extra: SheetExtra) => void;
    /** Out: the wicket steps for a fair ball. */
    readonly openOut: () => void;
    /** More: what the pad records less often than a ball, as much of it as the engine would take now (Task 13). */
    readonly openMore: () => void;
    /** A choice on the step on screen (`useCricketSheets`). */
    readonly choose: (id: string) => void;
    /** The over-end sheet's Undo: the pad's Undo (this phone's last tap), quiet in the moment the sheet appears. */
    readonly undoStanding: () => void;
    /** Record on the sheet of typed numbers (More's revision and rain break, Task 15): the fields as typed. */
    readonly enter: (values: readonly string[]) => void;
    /** Record over, on the over totals' entry (Task 17): the over's own runs, wickets and legal balls. */
    readonly enterTotals: (over: TotalsOver) => void;
    /** Players (Task 14): a tap on the board opens it on Batting; its tabs. */
    readonly openPlayers: () => void;
    readonly playersTab: (tab: PlayersTab) => void;
    /** ▲▼ on the batting tab's row `from` to row `to`, both yet to bat: the order pick, nothing recorded (ruling 78). */
    readonly moveYet: (from: number, to: number) => void;
    /** Between overs, a tap on one who may bowl the next: the over's pick, nothing recorded. */
    readonly pickBowler: (id: string) => void;
  };

/** What the cricket pad screen is drawn from: the shared model, the board and the display it is read from. */
export type CricketPadModel = PadScreenModel<CricketPadKey, CricketSheetView> & {
  readonly board: CricketBoardView;
  readonly display: CricketDisplay;
  /** The kit's Start screen pick: cricket's toss is an event of its own, so this is always none. */
  readonly toss: PadSide | null;
  /** The setup in the board's place before the first ball (the toss, the order, the bowler); none once play is on. */
  readonly setup: CricketSetupModel | null;
  /** More has something to offer now: the key is greyed when it has not. */
  readonly more: boolean;
  /** The over totals' entry (or the organiser's line for a tie) in the board's place, while a side is scored in totals. */
  readonly totals: CricketTotals | null;
  readonly actions: CricketPadActions;
};

export function useCricketMatch(fixtureId: string): ScoringMatch<CricketPadModel> {
  return useScoringMatch(fixtureId, cricketSport, useCricketPad);
}

type PadFacts = MatchPad<CricketTypes>;
type Sender = MatchSender<CricketTypes>;

/** Cricket flashes no half: the board stands in the halves' place. */
const ignoreFlash = (): void => undefined;
/** No half and no tool takes a tap: the board's keys (`CricketKeys`) are cricket's own actions. */
const noHalf = (): void => undefined;
const noTool = (): void => undefined;

const NOT_NOW: PadOutcome = refusing('notNow');

/** The flash side a recorded tap names: none is drawn, so any side will do. */
const NO_FLASH_SIDE: PadSide = 'first';

/**
 * No rally: a half takes no tap. Undo takes back this phone's last standing tap; with none, the runtime's own answer is
 * "nothing of yours to undo" (as badminton's), so the pad adds no second gate over it.
 */
function useCricketDriver(sender: Sender): PadTapDriver {
  return useMemo(() => ({ rally: () => NOT_NOW, undo: () => sender.undo() }), [sender]);
}

function useCricketPad(
  ports: Ports,
  runner: ScoringRunner | null,
  pad: PadFacts | null,
): CricketPadModel | null {
  const sender = useSender<CricketTypes>(ports, runner);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const settle = useSettle(sender.say);
  const driver = useCricketDriver(sender);
  const taps = useTaps(driver, settle, sender.say, ignoreFlash);
  const sheets = useSheets(taps, pad, sender);
  const setup = useCricketSetup(pad, sender, taps);
  useDropStalePicks(pad, sender.setPicks);
  const actions = useActions({ sender, runner, pad, taps, sheets, setup, setCardNote });
  useBackCloses(sheets.open, sheets.cancel);
  const board = useMemo(() => (pad === null ? null : cricketBoard(pad.display)), [pad]);
  const totals = useMemo(() => (pad === null ? null : totalsOf(pad.display)), [pad]);
  return useMemo(
    () => modelOf(pad, { board, setup: setup.model, totals }, sheets.view, cardNote, actions),
    [pad, board, setup.model, totals, sheets.view, cardNote, actions],
  );
}

/**
 * A pick the ledger went back from is dropped from the kept picks, on the disk too, as soon as the fold shows it
 * (`withoutStalePicks`): a Start innings after an Undo of the innings' last ball (the break asks again, the openers and
 * the bowler kept), and the next over's bowler after an Undo of the over's last ball (T19 D4: the over ended again asks
 * its bowler afresh). Nothing is written while nothing is stale.
 */
function useDropStalePicks(pad: PadFacts | null, setPicks: Sender['setPicks']) {
  const picks = pad?.picks ?? null;
  const display = pad?.display ?? null;
  useEffect(() => {
    if (picks === null || display === null) return;
    const kept = withoutStalePicks(picks, display);
    if (kept !== picks) setPicks(kept);
  }, [picks, display, setPicks]);
}

/** The stages the over totals stand in the board's place for: a side scored in totals, and its tie (`totalsView`). */
const TOTALS_STAGES: ReadonlySet<CricketStage> = new Set<CricketStage>(['totals', 'tiedNoPlayers']);

const totalsOf = (display: CricketDisplay): CricketTotals | null =>
  TOTALS_STAGES.has(display.stage) ? totalsView(display) : null;

/**
 * What cricket draws in the halves' place: the board, the setup while the match is before its first ball, or the over
 * totals while a side's players are not entered.
 */
type Body = {
  readonly board: CricketBoardView | null;
  readonly setup: CricketSetupModel | null;
  readonly totals: CricketTotals | null;
};

/** What the screen is drawn from, or none while the match is loading. */
function modelOf(
  pad: PadFacts | null,
  { board, setup, totals }: Body,
  sheet: CricketSheetView | null,
  cardNote: MessageKey | null,
  actions: CricketPadActions,
): CricketPadModel | null {
  if (pad === null || board === null) return null;
  return {
    kind: 'pad',
    view: pad.view,
    sheet,
    line: pad.line,
    cardNote,
    flash: null,
    toss: pad.toss,
    board,
    display: pad.display,
    setup,
    totals,
    more: moreOffered(pad.display),
    actions,
  };
}

/** The sheets over the pad, closed at once when the link dies, since the bad-link card then shows (round 8 hardening). */
function useSheets(taps: ReturnType<typeof useTaps>, pad: PadFacts | null, sender: Sender) {
  const snapshot = useMemo<CricketSheetSnapshot | null>(
    () =>
      pad === null
        ? null
        : {
            details: pad.view.details,
            history: pad.history,
            card: pad.view.card,
            ask: pad.ask,
            display: pad.display,
          },
    [pad],
  );
  const { tap, setPicks } = sender;
  const pick = useCallback(
    (made: CricketPick) => {
      if (pad !== null) setPicks(withPick(pad.picks, pad.display, made));
    },
    [pad, setPicks],
  );
  const send = useMemo(() => ({ tap, pick }), [tap, pick]);
  const sheets = useCricketSheets(snapshot, taps, send);
  useClosedByDeadLink(pad?.view, sheets.open, sheets.cancel);
  return sheets;
}

type Parts = {
  readonly sender: Sender;
  readonly runner: ScoringRunner | null;
  readonly pad: PadFacts | null;
  readonly taps: ReturnType<typeof useTaps>;
  readonly sheets: ReturnType<typeof useSheets>;
  readonly setup: ReturnType<typeof useCricketSetup>;
  readonly setCardNote: (note: MessageKey | null) => void;
};

function useActions(parts: Parts): CricketPadActions {
  const { sender, taps, sheets } = parts;
  const home = useBackToHome();
  const start = useStart(parts);
  const asked = useAskActions(
    sender.answer,
    taps.opening,
    sheets.justShown,
    sheets.actions.askDiscard,
  );
  const links = useLinks(parts.runner, parts.setCardNote);
  const record = useRecord(sender, taps);
  const run = useCallback(
    (runs: number) => record({ kind: 'ball', ball: runBall(runs) }),
    [record],
  );
  const { cancel } = sheets;
  const { undo } = taps;
  const { setPicks } = sender;
  return useMemo(
    () => ({
      home,
      undo,
      cancel,
      tapHalf: noHalf,
      tool: noTool,
      ...sheets.actions,
      ...asked,
      ...links,
      ...parts.setup.actions,
      ...start,
      record,
      setPicks,
      run,
    }),
    [
      run,
      home,
      undo,
      cancel,
      sheets.actions,
      asked,
      links,
      parts.setup.actions,
      start,
      record,
      setPicks,
    ],
  );
}

/**
 * A tap to the match through the bounce memory (`useTaps`): the same tap again inside the window counts once and the line
 * says so (the web's double-tap rule: the same action only), a different tap always counts, and a refusal says why.
 */
function useRecord(sender: Sender, taps: ReturnType<typeof useTaps>) {
  const { tap } = sender;
  const { point } = taps;
  return useCallback(
    (made: CricketTap) => point(JSON.stringify(made), NO_FLASH_SIDE, () => tap(made)),
    [point, tap],
  );
}

/**
 * Start match on the setup's last step: a tap with no side (the kit's, `useStartActions`), an opening tap, so a double
 * tap records one start. It records nothing until the setup is ready (the openers and the first bowler, spec §4.1), the
 * same reading that greys the button.
 */
function useStart({ sender, runner, pad, taps, setup }: Parts) {
  const { tap } = sender;
  const startWith = useCallback(() => tap({ kind: 'start' }), [tap]);
  // The literal `false`: there is no serve to pick, so Start match starts at once (`useStartActions`).
  const kit = useStartActions(runner, pad?.toss ?? null, startWith, taps.opening, false);
  const ready = setup.model?.ready === true;
  const { start: kitStart, pickServer } = kit;
  const start = useCallback(() => {
    if (ready) kitStart();
  }, [ready, kitStart]);
  return useMemo(() => ({ pickServer, start }), [pickServer, start]);
}
