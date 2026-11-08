import { useCallback, useMemo, useState } from 'react';
import { withPick, type CreasePair, type CricketPick } from '@/domain/scoring/cricketPicks';
import {
  moved,
  setupStep,
  setupView,
  type CricketSetupStep,
  type CricketSetupView,
} from '@/domain/scoring/cricketSetup';
import type { CricketStage, CricketTypes } from '@/domain/scoring/cricketTypes';
import { TAKEN } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { Arm, Opening, Point } from '@/hooks/usePadTaps';
import type { MatchSender } from '@/hooks/useScoringMatch';

/**
 * Cricket's setup before its first ball (S2-4 spec §4.1, owner ruling 83; plan Task 10): what the setup screen shows and
 * its buttons. The step is the display's (`setupStep`): the toss, the batting order, the first bowler, then Start match.
 * Two things are the phone's alone, held in memory while the screen shows: the toss's winner until Bat or Bowl records
 * the toss (a process death before then asks the toss again, which the brief accepts), and a step back from the bowler
 * to the order. The order, the openers and the bowler are pending picks (`withPick`), kept with the queue, so a reopened
 * match keeps them; the toss and Start are taps.
 */
export type CricketSetupModel = {
  /** The step shown: the display's, but the order again while the scorer has stepped back to it. */
  readonly step: CricketSetupStep;
  readonly view: CricketSetupView;
  /** The toss's winner, picked and not yet recorded (the second half names them). */
  readonly tossWinner: PadSide | null;
  /** Whether Start match may be tapped: nothing the first ball needs is missing (the display's step is `ready`). */
  readonly ready: boolean;
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
};

/** The bounce memory's parts the setup uses (`useTaps`). */
export type SetupTaps = {
  readonly opening: Opening;
  readonly arm: Arm;
  readonly secondTouch: () => boolean;
  /** A tap counted once for a repeat inside the window (the kit's double-tap rule); cricket flashes no half. */
  readonly point: Point;
};

/** Cricket's taps flash no half (`ignoreFlash`): the side a counted move names is never drawn. */
const NO_FLASH_SIDE: PadSide = 'first';

type Facts = MatchPad<CricketTypes>;
type Sender = MatchSender<CricketTypes>;

/** The stages the setup screen stands in the board's place for: no toss yet, and before Start. */
const SETUP_STAGES: ReadonlySet<CricketStage> = new Set<CricketStage>(['toss', 'setup']);

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
  };
}

function useSetupActions(
  pad: Facts | null,
  sender: Sender,
  taps: SetupTaps,
  held: ReturnType<typeof useHeld>,
): CricketSetupActions {
  const toss = useTossActions(held, taps.opening, sender.tap);
  const picks = usePickActions(pad, sender.setPicks, taps, held.set);
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

/**
 * The pending picks: the order, the openers (Next, which leaves the order, so it arms the bounce window) and the bowler.
 * Each is ignored as the second touch of a tap that left the screen under it.
 */
function usePickActions(
  pad: Facts | null,
  setPicks: Sender['setPicks'],
  { arm, secondTouch, point }: SetupTaps,
  set: ReturnType<typeof useHeld>['set'],
) {
  const pick = useCallback(
    (made: CricketPick) => {
      if (pad !== null) setPicks(withPick(pad.picks, pad.display, made));
    },
    [pad, setPicks],
  );
  const moveBatter = useMoveBatter(pad, pick, point);
  const setOpeners = useCallback(
    (pair: CreasePair) => {
      if (secondTouch()) return;
      pick({ kind: 'openers', ...pair });
      set((now) => ({ ...now, back: false }));
      arm('openers');
    },
    [secondTouch, pick, set, arm],
  );
  const setBowler = useCallback(
    (id: string) => {
      if (!secondTouch()) pick({ kind: 'bowler', bowler: id });
    },
    [secondTouch, pick],
  );
  return useMemo(
    () => ({ moveBatter, setOpeners, setBowler }),
    [moveBatter, setOpeners, setBowler],
  );
}

/**
 * ▲▼ in the batting order, each a tap of its own through the bounce memory (`point`, keyed by row and direction): the
 * same control again inside the window counts once and the line says so (M3: a double tap on ▲ would otherwise move the
 * batter up, then the one who slid into the row back down). Any tap inside the window of an opening one, the toss's Bat
 * or Bowl or Back, counts once too: the order list stands where those were.
 */
function useMoveBatter(pad: Facts | null, pick: (made: CricketPick) => void, point: Point) {
  return useCallback(
    (from: number, to: number) => {
      const side = pad?.display.innings?.batting;
      if (pad === null || side === undefined) return;
      const order = pad.display.battingOrder;
      point(`move.${from}.${to}`, NO_FLASH_SIDE, () => {
        pick({ kind: 'order', side, ids: moved(order, from, to) });
        return TAKEN;
      });
    },
    [pad, pick, point],
  );
}
