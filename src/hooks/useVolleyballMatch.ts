import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { TAKEN, refusing, refusalLine } from '@/domain/scoring/padLine';
import type { PadSide, PadText, PadView } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import { volleyballPeopleOf, type VolleyballPeople } from '@/domain/scoring/volleyballPeople';
import { sanctionNote } from '@/domain/scoring/volleyballSanction';
import { volleyballSport } from '@/domain/scoring/volleyballSport';
import { withHeldServing } from '@/domain/scoring/volleyballPad';
import type {
  VolleyballDisplay,
  VolleyballPadKey,
  VolleyballTypes,
} from '@/domain/scoring/volleyballTypes';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import type { RunnerSnapshot, ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useHeldServing } from '@/hooks/useHeldServing';
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
  useVolleyballSheets,
  type VolleyballSheetDriver,
  type VolleyballSheetSnapshot,
  type VolleyballSheetView,
} from '@/hooks/useVolleyballSheets';
import type { MessageKey } from '@/i18n/messages';

/**
 * A volleyball match on the pad screen (S2-6 Task 9): the generic match (`useScoringMatch`) with volleyball's pad hook, as
 * `useTableTennisMatch` is table tennis's. What is volleyball's here: a half is a rally that may carry the held answer
 * to Who serves first? (`useHeldServing`); at a set's 0-0 that needs one (the deciding set's toss, ruling 180) the first
 * tap on a half asks it in a sheet and the answer and the rally go together; Timeout and Sub open a side choice, More
 * holds Sanction (rulings 178, 185); and a sheet that lists people asks the match to read its teams again (ruling 181).
 */

/** Volleyball's own buttons, beside every pad's (`PadActions`). */
export type VolleyballPadActions = PadActions & {
  /** A choice on the sheet open: a side, a person, a level, a More item or the side serving. */
  readonly choose: (id: string) => void;
  readonly saveScore: (first: string, second: string) => void;
  /** The Start screen: who serves first, picked; then Start match, a tap. */
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
  /** The reconnect question (owner ruling 43): Send my taps, Discard them (which asks again) and its confirm's Discard. */
  readonly sendTaps: () => void;
  readonly askDiscard: () => void;
  readonly confirmDiscard: () => void;
};

/** What the volleyball pad screen is drawn from. */
export type VolleyballPadModel = PadScreenModel<VolleyballPadKey, VolleyballSheetView> & {
  /** The Start screen's pick of who serves first; none until the scorer picks, and none once the match starts. */
  readonly toss: PadSide | null;
  readonly actions: VolleyballPadActions;
};

export function useVolleyballMatch(fixtureId: string): ScoringMatch<VolleyballPadModel> {
  return useScoringMatch(fixtureId, volleyballSport, useVolleyballPad);
}

type PadFacts = MatchPad<VolleyballTypes>;
type Sender = MatchSender<VolleyballTypes>;
type Held = ReturnType<typeof useHeldServing>;

function useVolleyballPad(
  ports: Ports,
  runner: ScoringRunner | null,
  pad: PadFacts | null,
): VolleyballPadModel | null {
  const sender = useSender<VolleyballTypes>(ports, runner);
  const [flash, setFlash] = useState<HalfFlash>(null);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const held = useHeldServing(pad?.display.anchorNeeded ?? false, pad?.display.scoreEvents ?? 0);
  const settle = useSettle(sender.say);
  const { carry, clear } = held;
  const driver = useMemo<PadTapDriver>(
    () => ({
      rally: (side) =>
        carry((serving, servingAt) => sender.tap({ kind: 'rally', side, serving, servingAt })),
      // Undo takes this phone's last tap back: the answer made after it is made to a score that no longer stands.
      undo: () => {
        const outcome = sender.undo();
        if (outcome.ok) clear();
        return outcome;
      },
    }),
    [sender, carry, clear],
  );
  const taps = useTaps(driver, settle, sender.say, setFlash);
  const people = usePeople(runner);
  const sheets = useSheets(runner, sender, held, taps.opening, pad, people);
  const actions = useActions({ sender, runner, pad, taps, sheets, held, setCardNote });
  useBackCloses(sheets.open, sheets.cancel);
  const { lostToss } = sheets;
  const view = useMemo(
    () => (pad === null ? null : viewOf(pad, held.side, lostToss)),
    [pad, held.side, lostToss],
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
 * The pad's view as the scorer should read it now: under a held answer to Who serves first?, "Next point: {side}
 * serving" (ruling 180); and after a sanction whose consequence is the scorer's (a penalty gives the other side the
 * rally, an expulsion may leave a team short: rulings 174, 185, 189), that line in the last tap's place.
 */
function viewOf(
  pad: PadFacts,
  held: PadSide | null,
  lostToss: number | null,
): PadView<VolleyballPadKey> {
  const heldView = withHeldServing(pad.view, held, pad.display);
  // A held answer's line wins over a sanction's note: the scorer must read who serves next (review M2).
  const view = heldView === pad.view ? withSanctionNote(heldView, pad.display) : heldView;
  // The scorer tapped under a toss sheet another scorer's rally made moot: nothing was sent, and the line says why until
  // this phone records its next point.
  if (lostToss === null || lostToss !== pad.display.scoreEvents || pad.view.card !== null)
    return view;
  const text: PadText<VolleyballPadKey> = { key: 'scoring.volleyball.tossLost' };
  return { ...view, lastTap: { text, undo: view.lastTap?.undo ?? false } };
}

function withSanctionNote(
  view: PadView<VolleyballPadKey>,
  display: VolleyballDisplay,
): PadView<VolleyballPadKey> {
  const last = display.lastTap;
  if (last === null || last.kind !== 'sanction' || view.lastTap === null) return view;
  const text = sanctionNote(last.level, last.side, display.sides, display.beach);
  return text === null ? view : { ...view, lastTap: { ...view.lastTap, text } };
}

const NOBODY: VolleyballPeople = { first: [], second: [] };

/** The people the sheets list: the bootstrap's team sheets as the match holds them now, read again when a sheet asks. */
function usePeople(runner: ScoringRunner | null): VolleyballPeople {
  const snapshot = useSyncExternalStore(
    runner?.subscribe ?? noSubscribe,
    runner?.snapshot ?? loading,
  );
  const bootstrap = bootstrapOf(snapshot);
  return useMemo(() => (bootstrap === null ? NOBODY : volleyballPeopleOf(bootstrap)), [bootstrap]);
}

const noSubscribe = (): (() => void) => () => undefined;
const LOADING: RunnerSnapshot = { kind: 'loading' };
const loading = (): RunnerSnapshot => LOADING;

function bootstrapOf(snapshot: RunnerSnapshot) {
  return snapshot.kind === 'ready' ? snapshot.state.bootstrap : null;
}

/**
 * The sheets over the pad: what each button asks of the match, as taps (a timeout, a sub, a sanction, a set's score) or,
 * for Who serves first?, as the answer held for the next point or sent with the rally that asked. Closed at once when the
 * link dies, since the bad-link card then shows.
 */
function useSheets(
  runner: ScoringRunner | null,
  sender: Sender,
  held: Held,
  opening: ReturnType<typeof useTaps>['opening'],
  pad: PadFacts | null,
  people: VolleyballPeople,
) {
  const { tap, say } = sender;
  const { put, carry } = held;
  const peopleSheet = usePeopleSheet(runner);
  const driver = useMemo<VolleyballSheetDriver>(
    () => ({
      peopleSheet,
      timeout: (side) => tap({ kind: 'timeout', side }),
      sub: (made) => tap(made),
      sanction: (made) => tap(made),
      setScore: (first, second) => tap({ kind: 'setScore', first, second }),
      serving: (side) => (put(side) ? TAKEN : refusing('notNow')),
      // The answer and the rally go together (ruling 180): the answer is put, then carried by the rally. A rally the
      // match refuses leaves the answer held for the next tap, which then goes on without asking again.
      toss: (serving, tapped) =>
        put(serving)
          ? carry((answer, answeredAt) =>
              tap({ kind: 'rally', side: tapped, serving: answer, servingAt: answeredAt }),
            )
          : refusing('notNow'),
    }),
    [peopleSheet, tap, put, carry],
  );
  const refuseScore = useCallback(() => say(refusalLine('scoring.refusal.invalidScore')), [say]);
  const snapshot = useMemo<VolleyballSheetSnapshot | null>(
    () =>
      pad === null
        ? null
        : { display: pad.display, history: pad.history, card: pad.view.card, ask: pad.ask, people },
    [pad, people],
  );
  const sheets = useVolleyballSheets(driver, snapshot, opening, refuseScore);
  useClosedByDeadLink(pad?.view, sheets.open, sheets.cancel);
  return sheets;
}

type Parts = {
  readonly sender: Sender;
  readonly runner: ScoringRunner | null;
  readonly pad: PadFacts | null;
  readonly taps: ReturnType<typeof useTaps>;
  readonly sheets: ReturnType<typeof useSheets>;
  readonly held: Held;
  readonly setCardNote: (note: MessageKey | null) => void;
};

function useActions(parts: Parts): VolleyballPadActions {
  const { taps, sheets } = parts;
  const home = useBackToHome();
  const start = useStart(parts);
  const asked = useAsk(parts);
  const links = useLinks(parts.runner, parts.setCardNote);
  const tool = useGuardedTool(taps.secondTouch, sheets.actions.tool);
  const tapHalf = useHalf(parts);
  const { undo } = taps;
  return useMemo(
    () => ({ home, tapHalf, undo, ...sheets.actions, tool, ...asked, ...links, ...start }),
    [home, tapHalf, undo, tool, sheets.actions, asked, links, start],
  );
}

/**
 * A tap on a half: a rally, except at a set's 0-0 that needs the answer to Who serves first? and holds none, where it
 * asks (ruling 180: once, as a sheet on the first tap), remembering which half was tapped. A match that is not on the
 * pad (a card stands over it) goes to the tap, which the match refuses in words.
 */
function useHalf({ pad, taps, sheets, held }: Parts) {
  const { tapHalf, bounced } = taps;
  const asks = pad !== null && asksToss(pad, held.side === null);
  const toss = sheets.toss;
  return useCallback(
    (side: PadSide) => {
      if (!asks) return tapHalf(side);
      // The second touch of a double tap on the rally that ended the set lands on the toss sheet's half: counted once, as
      // on every pad, never a sheet over a rally already queued (review I1).
      if (!bounced(side)) toss(side);
    },
    [asks, toss, tapHalf, bounced],
  );
}

/**
 * Whether a first tap asks who serves: nobody can say, no rally stands, no answer is held (a rally the match refused
 * leaves it held for the next tap) and no card is over the pad.
 */
function asksToss(pad: PadFacts, nothingHeld: boolean): boolean {
  const { display, view } = pad;
  return nothingHeld && display.anchorNeeded && display.phase !== 'live' && view.card === null;
}

/** Start match is a tap carrying the side picked to serve first (ruling 179), through the bounce memory. */
function useStart({ sender, runner, pad, taps }: Parts) {
  const { tap } = sender;
  const startWith = useCallback((server: PadSide) => tap({ kind: 'start', server }), [tap]);
  return useStartActions(runner, pad?.toss ?? null, startWith, taps.opening);
}

/** The reconnect question's answers (owner ruling 43), the same for every sport (`useAskActions`). */
function useAsk({ sender, taps, sheets }: Parts) {
  return useAskActions(sender.answer, taps.opening, sheets.justShown, sheets.actions.askDiscard);
}
