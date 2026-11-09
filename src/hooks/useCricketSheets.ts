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
  | AskView;

type Sheet =
  | { readonly kind: 'details' }
  | { readonly kind: 'history' }
  | { readonly kind: 'discard' }
  | { readonly kind: 'flow'; readonly flow: CricketFlow }
  | { readonly kind: 'players'; readonly tab: PlayersTab }
  | { readonly kind: 'entry'; readonly entry: CricketEntryFlow }
  | null;

const DETAILS: Sheet = { kind: 'details' };
const HISTORY: Sheet = { kind: 'history' };
const DISCARD: Sheet = { kind: 'discard' };
const PLAYERS: Sheet = { kind: 'players', tab: 'batting' };

/** The name a sheet's close has in the bounce memory. */
const CLOSE_TAP = 'close';

/** The taps' parts the sheets use (`useTaps`). */
export type SheetTaps = {
  readonly arm: Arm;
  readonly opening: Opening;
  readonly choose: Choose;
  readonly secondTouch: () => boolean;
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
 * screen (`secondTouch`); a step's choice on the heels of the step appearing is ignored (`useJustShown`). A choice that
 * records is an opening tap: the sheet goes, and the second touch lands on the keys.
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
  // No match to put a sheet over, or the question over it: no sheet stays open behind it.
  if (sheet !== null && (snapshot === null || staleByAsk(sheet.kind, snapshot))) setSheet(null);
  const details = useCallback(() => setSheet(DETAILS), []);
  const history = useCallback(() => setSheet(HISTORY), []);
  const { arm, secondTouch } = taps;
  const dismiss = useCallback(() => {
    if (justShown()) return;
    arm(CLOSE_TAP);
    cancel();
  }, [justShown, arm, cancel]);
  // Discard asks again before it deletes: quiet in the bounce window of the question appearing.
  const askDiscard = useCallback(() => {
    if (snapshot !== null && !justShown()) setSheet(DISCARD);
  }, [snapshot, justShown]);
  const openFlow = useCallback(
    (flow: CricketFlow) => {
      if (snapshot !== null && !secondTouch()) setSheet({ kind: 'flow', flow });
    },
    [snapshot, secondTouch],
  );
  const openExtras = useCallback(
    (extra: SheetExtra) => openFlow({ kind: 'extras', extra }),
    [openFlow],
  );
  const openOut = useCallback(() => openFlow(outFlow()), [openFlow]);
  const openMore = useCallback(() => openFlow(moreFlow()), [openFlow]);
  const choose = useChoose({ sheet, snapshot, justShown, taps, send, setSheet });
  const enter = useEnter({ sheet, snapshot, justShown, taps, send, setSheet });
  const players = usePlayersActions({ snapshot, justShown, taps, send, setSheet });
  const actions = useMemo(
    () => ({
      details,
      history,
      dismiss,
      askDiscard,
      openExtras,
      openOut,
      openMore,
      choose,
      enter,
      ...players,
    }),
    [details, history, dismiss, askDiscard, openExtras, openOut, openMore, choose, enter, players],
  );
  return { open: sheet !== null, cancel, actions, view, justShown };
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
 * Players (S2-4 spec §4.8a; rulings 77 and 78): a tap on the board opens it on Batting (ignored as the second touch of a
 * tap that left the screen). ▲▼ on one yet to bat, and between overs a tap on one who may bowl the next, keep a pick,
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
    if (snapshot !== null && !secondTouch()) setSheet(PLAYERS);
  }, [snapshot, secondTouch, setSheet]);
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
    case 'entry': {
      const { entry } = sheet;
      const { display } = snapshot;
      const accepts = (values: readonly string[]) => entryTap(entry, display, values) !== null;
      return { kind: 'entry', step: entryStep(entry, display), accepts };
    }
  }
}
