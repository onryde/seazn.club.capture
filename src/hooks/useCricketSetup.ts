import { useCallback, useMemo, useState } from 'react';
import { cricketBreakCard, type CricketBreakCard } from '@/domain/scoring/cricketPad';
import { withPick, type CreasePair, type CricketPick } from '@/domain/scoring/cricketPicks';
import {
  orderMoved,
  setupStep,
  setupView,
  type CricketSetupStep,
  type CricketSetupView,
} from '@/domain/scoring/cricketSetup';
import type { CricketDisplay, CricketStage, CricketTypes } from '@/domain/scoring/cricketTypes';
import { TAKEN } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import { useJustShown } from '@/hooks/usePadSheetParts';
import type { Arm, Choose, Opening } from '@/hooks/usePadTaps';
import type { MatchSender } from '@/hooks/useScoringMatch';

/**
 * Cricket's setup before its first ball (S2-4 spec §4.1, owner ruling 83; plan Task 10): what the setup screen shows and
 * its buttons. The step is the display's (`setupStep`): the toss, the batting order, the first bowler, then Start match.
 * Two things are the phone's alone, held in memory while the screen shows: the toss's winner until Bat or Bowl records
 * the toss (a process death before then asks the toss again, which the brief accepts), and a step back from the bowler
 * to the order. The order, the openers and the bowler are pending picks (`withPick`), kept with the queue, so a reopened
 * match keeps them; the toss and Start are taps.
 *
 * The same setup stands at an innings break and before a super over (spec §4.5, §4.6; plan Task 16), under the break's
 * card: the next innings' order and openers, its bowler, then Start innings, which is a pick too (`begin`), not a tap, so
 * it records nothing and the picks ride the first ball.
 */
export type CricketSetupModel = {
  /** The step shown: the display's, but the order again while the scorer has stepped back to it. */
  readonly step: CricketSetupStep;
  readonly view: CricketSetupView;
  /** The toss's winner, picked and not yet recorded (the second half names them). */
  readonly tossWinner: PadSide | null;
  /** Whether Start match may be tapped: nothing the first ball needs is missing (the display's step is `ready`). */
  readonly ready: boolean;
  /** What the last button starts: the match (Start match, a tap), or the innings due after a break (Start innings). */
  readonly begins: 'match' | 'innings';
  /** The break's card over the setup (`cricketBreakCard`); none before the match's first ball. */
  readonly card: CricketBreakCard | null;
};

export type CricketSetupActions = {
  /** "Who won the toss?": held until Bat or Bowl; a second tap changes it. */
  readonly pickTossWinner: (side: PadSide) => void;
  /** Bat or Bowl: records `cricket.toss {wonBy, elected}` for the winner held; nothing while none is. */
  readonly recordToss: (elected: 'bat' | 'bowl') => void;
  /** ▲ or ▼: the batter at `from` to `to` in the batting side's order (`setOrder`, a pending pick). */
  readonly moveBatter: (from: number, to: number) => void;
  /** Next: the order's first two open, the first on strike (a pending pick). */
  readonly setOpeners: (pair: CreasePair) => void;
  /** The first over's bowler (a pending pick). */
  readonly setBowler: (id: string) => void;
  /** Back, from the bowler to the batting order. */
  readonly changeOrder: () => void;
  /** Start innings, once the setup of an innings after a break is ready: a pending pick, nothing recorded (§4.5). */
  readonly startInnings: () => void;
};

/** The bounce memory's parts the setup uses (`useTaps`). */
export type SetupTaps = {
  readonly opening: Opening;
  readonly arm: Arm;
  readonly secondTouch: () => boolean;
  /** A choice kept, counted once for a repeat inside the window (the kit's double-tap rule), leaving the line as it was. */
  readonly choose: Choose;
};

type Facts = MatchPad<CricketTypes>;
type Sender = MatchSender<CricketTypes>;

/** The stages the setup screen stands in the board's place for: no toss yet, before Start, and an innings break's. */
const SETUP_STAGES: ReadonlySet<CricketStage> = new Set<CricketStage>([
  'toss',
  'setup',
  'break',
  'superOverSetup',
]);

/** The breaks: the setup of an innings after one, which a double tap's second touch may land on as it appears. */
const BREAK_STAGES: ReadonlySet<CricketStage> = new Set<CricketStage>(['break', 'superOverSetup']);

type Held = { readonly winner: PadSide | null; readonly back: boolean };
const NOTHING_HELD: Held = { winner: null, back: false };

export function useCricketSetup(pad: Facts | null, sender: Sender, taps: SetupTaps) {
  const held = useHeld(pad?.display.stage ?? null);
  const model = useMemo(() => modelOf(pad, held.now), [pad, held.now]);
  const actions = useSetupActions(pad, sender, taps, held);
  return { model, actions };
}

/**
 * What the phone holds, dropped whenever the stage changes: the toss recorded (or undone), Start, or a later innings.
 * Reset during render, as React's derived-state pattern, so no frame shows a stale winner.
 */
function useHeld(stage: CricketStage | null) {
  const [now, set] = useState<Held>(NOTHING_HELD);
  const [heldAt, setHeldAt] = useState(stage);
  if (heldAt !== stage) {
    setHeldAt(stage);
    set(NOTHING_HELD);
  }
  return { now, set };
}

function modelOf(pad: Facts | null, held: Held): CricketSetupModel | null {
  if (pad === null || !SETUP_STAGES.has(pad.display.stage)) return null;
  const step = setupStep(pad.display);
  // A step back is held only while the stage is the setup's (`useHeld` drops it with the stage), so past the toss.
  return {
    step: held.back ? 'order' : step,
    view: setupView(pad.display),
    tossWinner: held.winner,
    ready: step === 'ready',
    begins: pad.display.stage === 'setup' ? 'match' : 'innings',
    card: cricketBreakCard(pad.display),
  };
}

/**
 * The break's name while one stands (its stage and the innings it is for), else none: its setup's controls are quiet in
 * the bounce window of it appearing (`useJustShown`), since the thumb that lifted off the innings' last key lands there.
 */
function breakName(display: CricketDisplay | null): string | null {
  if (display === null || !BREAK_STAGES.has(display.stage)) return null;
  return `${display.stage}.${display.innings?.ordinal ?? ''}`;
}

function useSetupActions(
  pad: Facts | null,
  sender: Sender,
  taps: SetupTaps,
  held: ReturnType<typeof useHeld>,
): CricketSetupActions {
  const toss = useTossActions(held, taps.opening, sender.tap);
  const shown = useJustShown(breakName(pad?.display ?? null));
  const picks = usePickActions(pad, sender.setPicks, { ...taps, shown }, held.set);
  const { set } = held;
  const { arm, secondTouch } = taps;
  // Back stands in the foot where Next was: the second touch of a double tap on Next must not land on it (M2).
  const changeOrder = useCallback(() => {
    if (secondTouch()) return;
    set((now) => ({ ...now, back: true }));
    arm('changeOrder');
  }, [secondTouch, set, arm]);
  return useMemo(() => ({ ...toss, ...picks, changeOrder }), [toss, picks, changeOrder]);
}

/** The toss: a team held (a second tap changes it), then Bat or Bowl records it, an opening tap (the halves go). */
function useTossActions(held: ReturnType<typeof useHeld>, opening: Opening, tap: Sender['tap']) {
  const { set } = held;
  const winner = held.now.winner;
  const pickTossWinner = useCallback(
    (side: PadSide) => set((now) => ({ ...now, winner: side })),
    [set],
  );
  const recordToss = useCallback(
    (elected: 'bat' | 'bowl') => {
      if (winner !== null) opening('toss', () => tap({ kind: 'toss', wonBy: winner, elected }));
    },
    [winner, opening, tap],
  );
  return useMemo(() => ({ pickTossWinner, recordToss }), [pickTossWinner, recordToss]);
}

/** The setup's taps, and whether a break has just appeared under the thumb. */
type PickTaps = SetupTaps & { readonly shown: () => boolean };

/**
 * The pending picks: the order, the openers (Next, which leaves the order, so it arms the bounce window), the bowler and
 * Start innings (which leaves the setup, so it arms it too). Each is ignored as the second touch of a tap that left the
 * screen under it, and at a break in the moment it appears.
 */
function usePickActions(
  pad: Facts | null,
  setPicks: Sender['setPicks'],
  { arm, secondTouch, choose, shown }: PickTaps,
  set: ReturnType<typeof useHeld>['set'],
) {
  const pick = useCallback(
    (made: CricketPick) => {
      if (pad !== null) setPicks(withPick(pad.picks, pad.display, made));
    },
    [pad, setPicks],
  );
  const moveBatter = useMoveBatter(pad, pick, choose, shown);
  const setOpeners = useCallback(
    (pair: CreasePair) => {
      if (shown() || secondTouch()) return;
      pick({ kind: 'openers', ...pair });
      set((now) => ({ ...now, back: false }));
      arm('openers');
    },
    [shown, secondTouch, pick, set, arm],
  );
  const setBowler = useCallback(
    (id: string) => {
      if (!shown() && !secondTouch()) pick({ kind: 'bowler', bowler: id });
    },
    [shown, secondTouch, pick],
  );
  const startInnings = useStartInnings(pad, pick, { arm, secondTouch, shown });
  return useMemo(
    () => ({ moveBatter, setOpeners, setBowler, startInnings }),
    [moveBatter, setOpeners, setBowler, startInnings],
  );
}

/**
 * Start innings: the innings due begins (`begin`, a pending pick), so the board and its keys stand again; nothing is
 * recorded, and the line is left as it was. Nothing until the setup is ready, the reading that greys the button. It
 * leaves the screen under the thumb, so it arms the bounce window: a second touch on a key counts once.
 */
function useStartInnings(
  pad: Facts | null,
  pick: (made: CricketPick) => void,
  { arm, secondTouch, shown }: Pick<PickTaps, 'arm' | 'secondTouch' | 'shown'>,
) {
  return useCallback(() => {
    if (pad === null || setupStep(pad.display) !== 'ready' || shown() || secondTouch()) return;
    pick({ kind: 'begin' });
    arm('startInnings');
  }, [pad, pick, arm, secondTouch, shown]);
}

/**
 * ▲▼ in the batting order, each a choice of its own through the bounce memory (`choose`, keyed by row and direction): the
 * same control again inside the window counts once and the line says so (M3: a double tap on ▲ would otherwise move the
 * batter up, then the one who slid into the row back down). Any tap inside the window of an opening one, the toss's Bat
 * or Bowl or Back, counts once too: the order list stands where those were. At a break the row is the one the setup
 * offers (`orderMoved`: a batter a super over dismissed keeps their place), and nothing moves as the break appears.
 */
function useMoveBatter(
  pad: Facts | null,
  pick: (made: CricketPick) => void,
  choose: Choose,
  shown: () => boolean,
) {
  return useCallback(
    (from: number, to: number) => {
      const side = pad?.display.innings?.batting;
      if (pad === null || side === undefined || shown()) return;
      const { display } = pad;
      choose(`move.${from}.${to}`, () => {
        pick({ kind: 'order', side, ids: orderMoved(display, from, to) });
        return TAKEN;
      });
    },
    [pad, pick, choose, shown],
  );
}
