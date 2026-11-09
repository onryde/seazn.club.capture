import { useCallback, useMemo, useState } from 'react';
import { entryStep, entryTap, type CricketEntryStep } from '@/domain/scoring/cricketEntry';
import type { SheetExtra } from '@/domain/scoring/cricketExtras';
import {
  flowChoice,
  flowStep,
  moreFlow,
  outFlow,
  standingFlow,
  type CricketFlow,
} from '@/domain/scoring/cricketFlow';
import type { CricketEntryFlow } from '@/domain/scoring/cricketMoreSteps';
import type { CricketPick } from '@/domain/scoring/cricketPicks';
import {
  playersBowler,
  playersView,
  yetMoved,
  type CricketPlayersView,
  type PlayersTab,
} from '@/domain/scoring/cricketPlayers';
import {
  totalsTap,
  totalsView,
  type CricketTotalsEntry,
  type TotalsOver,
} from '@/domain/scoring/cricketTotals';
import type {
  CricketDisplay,
  CricketPadKey,
  CricketStep,
  CricketTap,
} from '@/domain/scoring/cricketTypes';
import { TAKEN, type PadOutcome } from '@/domain/scoring/padLine';
import type { PadHistoryGroup, PadMatchDetails } from '@/domain/scoring/padView';
import {
  askedView,
  staleByAsk,
  useJustShown,
  type AskFacts,
  type AskView,
} from '@/hooks/usePadSheetParts';
import type { Arm, Choose, Opening } from '@/hooks/usePadTaps';

/**
 * The sheets over the cricket pad (S2-4 plan Tasks 8 and 11 to 15): Match details, History, the reconnect question over
 * them both, Players (a tap on the board), and the sheets that go step by step (an extra's runs, the wicket steps, …),
 * each step the domain's (`cricketFlow.ts`). Chess's twin is `useChessSheets`; what the sports share (the bounce window of a sheet appearing,
 * the question) is `usePadSheetParts`.
 */

/** What the sheets are drawn from: Match details and History as the pad has them, the question, and the display. */
export type CricketSheetSnapshot = AskFacts & {
  readonly details: PadMatchDetails<CricketPadKey>;
  readonly history: readonly PadHistoryGroup<CricketPadKey>[];
  readonly display: CricketDisplay;
};

/**
 * What is over the pad: a step is the domain's, which the screen draws (`CricketStepSheet`). A standing step (the
 * over-end sheet) was opened by no key and has no Cancel: it goes when its choice is made or the last ball is undone.
 */
export type CricketSheetView =
  | { readonly kind: 'details'; readonly details: PadMatchDetails<CricketPadKey> }
  | { readonly kind: 'history'; readonly groups: readonly PadHistoryGroup<CricketPadKey>[] }
  | { readonly kind: 'step'; readonly step: CricketStep; readonly standing: boolean }
  | { readonly kind: 'players'; readonly tab: PlayersTab; readonly players: CricketPlayersView }
  /** Numbers More asks typed (a revision, a rain break's overs lost); `accepts` greys Record while they make no event. */
  | {
      readonly kind: 'entry';
      readonly step: CricketEntryStep;
      readonly accepts: (values: readonly string[]) => boolean;
    }
  /** The over totals' entry over the over-end sheet (the row "Enter over totals"): the stage's own is the pad's body. */
  | { readonly kind: 'totals'; readonly totals: CricketTotalsEntry }
  | AskView;

type Sheet =
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | { readonly kind: 'flow'; readonly flow: CricketFlow }
  | { readonly kind: 'players'; readonly tab: PlayersTab }
  | { readonly kind: 'entry'; readonly entry: CricketEntryFlow }
  | { readonly kind: 'totals' }
  | null;

const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };
const PLAYERS: Sheet = { kind: 'players', tab: 'batting' };
const TOTALS: Sheet = { kind: 'totals' };

/** The name a sheet's close has in the bounce memory. */
const CLOSE_TAP = 'close';

/** The taps' parts the sheets use (`useTaps`). */
export type SheetTaps = {
  readonly arm: Arm;
  readonly opening: Opening;
  readonly choose: Choose;
  readonly secondTouch: () => boolean;
  /** Undo of this phone's last tap (`useTaps`): the standing sheet's button reaches it through the sheet-appearing guard. */
  readonly undo: () => void;
};

/** What a choice on a step sends: a tap to the match, or the whole pending picks with one more kept. */
export type SheetSender = {
  readonly tap: (made: CricketTap) => PadOutcome;
  readonly pick: (made: CricketPick) => void;
};

/**
 * The sheet over the cricket pad. Match details and History open from the top bar; Close, the dim and Back close them.
 * Every close by touch (`dismiss`) arms the bounce window without making a tap, so the second touch of a double tap on
 * Close cannot reach what was under it. A key that opens a sheet is ignored as the second touch of a tap that left the
 * screen (`secondTouch`), and a button on a sheet that has just appeared is ignored (`useJustShown`): a step's choice, the
 * standing sheet's Undo, More and Players. A choice that records is an opening tap: the sheet goes, and the second touch
 * lands on the keys.
 */
export function useCricketSheets(
  snapshot: CricketSheetSnapshot | null,
  taps: SheetTaps,
  send: SheetSender,
) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const cancel = useCallback(() => setSheet(null), []);
  const view = useMemo(() => sheetView(sheet, snapshot), [sheet, snapshot]);
  const justShown = useJustShown(guardedStep(view));
  // No match to put a sheet over, or the question over it: no sheet stays open behind it. Nor does an entry of over totals
  // once the match has none to enter (the ledger moved under it).
  if (
    sheet !== null &&
    (snapshot === null || staleByAsk(sheet.kind, snapshot) || noTotals(sheet, snapshot))
  )
    setSheet(null);
  const actions = useSheetActions({ sheet, snapshot, justShown, taps, send, setSheet });
  return { open: sheet !== null, cancel, actions, view, justShown };
}

/** Every button the sheets answer to, each its own guarded callback (below). */
function useSheetActions(parts: ChooseParts) {
  const closing = useClosing(parts);
  const opening = useOpening(parts);
  const choose = useChoose(parts);
  const enter = useEnter(parts);
  const enterTotals = useEnterTotals(parts);
  const players = usePlayersActions(parts);
  return useMemo(
    () => ({ ...closing, ...opening, choose, enter, enterTotals, ...players }),
    [closing, opening, choose, enter, enterTotals, players],
  );
}

/**
 * The ways off a sheet by touch. Close arms the bounce window and goes (`dismiss`); Discard asks again before it deletes
 * (`askDiscard`), quiet in the bounce window of the question appearing; the standing sheet's Undo (`undoStanding`) takes
 * back this phone's last tap, quiet in the window of the sheet appearing, since it stands where the thumb that lifted off
 * the over's last key lands (Batch 4 review C1).
 */
function useClosing({ snapshot, justShown, taps, setSheet }: ChooseParts) {
  const { arm, undo } = taps;
  const dismiss = useCallback(() => {
    if (justShown()) return;
    arm(CLOSE_TAP);
    setSheet(null);
  }, [justShown, arm, setSheet]);
  const askDiscard = useCallback(() => {
    if (snapshot !== null && !justShown()) setSheet(DISCARD);
  }, [snapshot, justShown, setSheet]);
  const undoStanding = useCallback(() => {
    if (!justShown()) undo();
  }, [justShown, undo]);
  return useMemo(
    () => ({ dismiss, askDiscard, undoStanding }),
    [dismiss, askDiscard, undoStanding],
  );
}

/**
 * The buttons that open a sheet. Match details and History open from the top bar. The keys' Out, More and extras, and the
 * standing sheet's More, open a step: ignored as the second touch of a tap that left the screen (`secondTouch`), and in the
 * window of a sheet that has just appeared (`justShown`), where a double tap's second touch lands on the standing sheet's
 * More (Batch 4 review I3).
 */
function useOpening({ snapshot, justShown, taps, setSheet }: ChooseParts) {
  const { secondTouch } = taps;
  const details = useCallback(() => setSheet(DETAILS), [setSheet]);
  const history = useCallback(() => setSheet(HISTORY), [setSheet]);
  const openFlow = useCallback(
    (flow: CricketFlow) => {
      if (snapshot !== null && !justShown() && !secondTouch()) setSheet({ kind: 'flow', flow });
    },
    [snapshot, justShown, secondTouch, setSheet],
  );
  const openExtras = useCallback(
    (extra: SheetExtra) => openFlow({ kind: 'extras', extra }),
    [openFlow],
  );
  const openOut = useCallback(() => openFlow(outFlow()), [openFlow]);
  const openMore = useCallback(() => openFlow(moreFlow()), [openFlow]);
  return useMemo(
    () => ({ details, history, openExtras, openOut, openMore }),
    [details, history, openExtras, openOut, openMore],
  );
}

type ChooseParts = {
  readonly sheet: Sheet;
  readonly snapshot: CricketSheetSnapshot | null;
  readonly justShown: () => boolean;
  readonly taps: SheetTaps;
  readonly send: SheetSender;
  readonly setSheet: (sheet: Sheet) => void;
};

/**
 * Players (S2-4 spec §4.8a; rulings 77 and 78): a tap on the board, or the standing sheet's button, opens it on Batting
 * (ignored as the second touch of a tap that left the screen, and in the window of a sheet that has just appeared). ▲▼ on one yet to bat, and between overs a tap on one who may bowl the next, keep a pick,
 * recording nothing; each is one choice in the bounce memory (▲▼ keyed by row and direction: the second touch of a
 * double tap lands on the same row's button, now another batter's), and nothing on the heels of the sheet appearing.
 */
function usePlayersActions({
  snapshot,
  justShown,
  taps,
  send,
  setSheet,
}: Omit<ChooseParts, 'sheet'>) {
  const { secondTouch, choose } = taps;
  const openPlayers = useCallback(() => {
    if (snapshot !== null && !justShown() && !secondTouch()) setSheet(PLAYERS);
  }, [snapshot, justShown, secondTouch, setSheet]);
  const playersTab = useCallback(
    (tab: PlayersTab) => setSheet({ kind: 'players', tab }),
    [setSheet],
  );
  const keep = useCallback(
    (name: string, made: CricketPick | null) => {
      if (made === null || justShown()) return;
      choose(name, () => {
        send.pick(made);
        return TAKEN;
      });
    },
    [justShown, choose, send],
  );
  const moveYet = useCallback(
    (from: number, to: number) => {
      if (snapshot !== null) keep(`move.${from}.${to}`, yetMoved(snapshot.display, from, to));
    },
    [snapshot, keep],
  );
  const pickBowler = useCallback(
    (id: string) => {
      if (snapshot !== null) keep(`bowler.${id}`, playersBowler(snapshot.display, id));
    },
    [snapshot, keep],
  );
  return useMemo(
    () => ({ openPlayers, playersTab, moveYet, pickBowler }),
    [openPlayers, playersTab, moveYet, pickBowler],
  );
}

/**
 * A choice on the step on screen: the next step, or the sheet closes and the choice is recorded (an opening tap, once for
 * a double tap) or kept (a pick, which leaves the line as it was). Nothing on the heels of the step appearing.
 */
function useChoose({ sheet, snapshot, justShown, taps, send, setSheet }: ChooseParts) {
  const { opening, choose } = taps;
  return useCallback(
    (id: string) => {
      if (snapshot === null || justShown()) return;
      const flow =
        sheet?.kind === 'flow'
          ? sheet.flow
          : sheet === null
            ? standingFlow(snapshot.display)
            : null;
      if (flow === null) return;
      const outcome = flowChoice(flow, snapshot.display, id);
      if (outcome === null) return;
      if (outcome.kind === 'next') {
        setSheet({ kind: 'flow', flow: outcome.flow });
        return;
      }
      if (outcome.kind === 'entry') {
        setSheet({ kind: 'entry', entry: outcome.entry });
        return;
      }
      if (outcome.kind === 'totals') {
        setSheet(TOTALS);
        return;
      }
      setSheet(null);
      if (outcome.kind === 'tap') {
        opening(JSON.stringify(outcome.tap), () => send.tap(outcome.tap));
        return;
      }
      choose(JSON.stringify(outcome.pick), () => {
        send.pick(outcome.pick);
        return TAKEN;
      });
    },
    [sheet, snapshot, justShown, opening, choose, send, setSheet],
  );
}

/**
 * Record on the sheet of typed numbers: the event they make, recorded as an opening tap as the sheet goes; nothing while
 * they make none (Record is greyed then), and nothing on the heels of the sheet appearing.
 */
function useEnter({ sheet, snapshot, justShown, taps, send, setSheet }: ChooseParts) {
  const { opening } = taps;
  return useCallback(
    (values: readonly string[]) => {
      if (snapshot === null || sheet?.kind !== 'entry' || justShown()) return;
      const made = entryTap(sheet.entry, snapshot.display, values);
      if (made === null) return;
      setSheet(null);
      opening(JSON.stringify(made), () => send.tap(made));
    },
    [sheet, snapshot, justShown, opening, send, setSheet],
  );
}

/**
 * Record over on the over totals' entry, the pad's own or the over-end sheet's: the summary the figures make
 * (`totalsTap`), recorded as an opening tap, since the entry starts again at the next over under the same thumb and the
 * second touch of a double tap would record an extra maiden over. Nothing while no entry stands (the ball pad's innings
 * takes no summary), while the figures make no summary the engine takes, or on the heels of the sheet appearing.
 */
function useEnterTotals({ sheet, snapshot, justShown, taps, send, setSheet }: ChooseParts) {
  const { opening } = taps;
  return useCallback(
    (over: TotalsOver) => {
      if (snapshot === null || justShown()) return;
      if (sheet?.kind !== 'totals' && snapshot.display.stage !== 'totals') return;
      const made = totalsTap(snapshot.display, over);
      if (made === null) return;
      setSheet(null);
      opening(JSON.stringify(made), () => send.tap(made));
    },
    [sheet, snapshot, justShown, opening, send, setSheet],
  );
}

/** The sheet of over totals is open and the match has nothing of the kind to enter any more. */
function noTotals(sheet: NonNullable<Sheet>, snapshot: CricketSheetSnapshot): boolean {
  return sheet.kind === 'totals' && totalsView(snapshot.display)?.kind !== 'entry';
}

/**
 * The step on screen a double tap can reach, by name: Match details (whose dim takes the second touch on its icon), the
 * question and its confirm, every step of a sheet that goes step by step, and More's typed numbers (`entry`, which ends
 * its flow, so never follows another). Not History: its one button is not under its icon.
 */
function guardedStep(view: CricketSheetView | null): string | null {
  if (view === null || view.kind === 'history') return null;
  return view.kind === 'step' ? `step.${view.step.name}` : view.kind;
}

function sheetView(sheet: Sheet, snapshot: CricketSheetSnapshot | null): CricketSheetView | null {
  if (snapshot === null) return null;
  // The reconnect question stands over everything while it stands, and its confirm over it.
  const asked = askedView(sheet?.kind, snapshot);
  if (asked !== null) return asked;
  if (sheet === null) {
    const standing = standingFlow(snapshot.display);
    return standing === null
      ? null
      : { kind: 'step', step: flowStep(standing, snapshot.display), standing: true };
  }
  switch (sheet.kind) {
    case 'details':
      return { kind: 'details', details: snapshot.details };
    case 'history':
      return { kind: 'history', groups: snapshot.history };
    case 'discard':
      return null;
    case 'flow':
      return { kind: 'step', step: flowStep(sheet.flow, snapshot.display), standing: false };
    case 'players':
      return { kind: 'players', tab: sheet.tab, players: playersView(snapshot.display) };
    case 'totals': {
      const totals = totalsView(snapshot.display);
      return totals?.kind === 'entry' ? { kind: 'totals', totals } : null;
    }
    case 'entry': {
      const { entry } = sheet;
      const { display } = snapshot;
      const accepts = (values: readonly string[]) => entryTap(entry, display, values) !== null;
      return { kind: 'entry', step: entryStep(entry, display), accepts };
    }
  }
}
