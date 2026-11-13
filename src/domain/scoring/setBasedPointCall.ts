import {
  EngineError,
  foldMatch,
  type EventEnvelope,
  type FoldableModule,
} from '@seazn/engine/core';
import type { SetBasedCfg, SetBasedState } from '@seazn/engine/sports/setbased';
import type { PadCall, PadSide } from '@/domain/scoring/padView';
import type { SetBasedEngineMatch } from '@/domain/scoring/setBasedEngine';
import type { SetBasedEvents, SetBasedFolding } from '@/domain/scoring/setBasedFold';

/**
 * Which side has game point, match point or the golden point (badminton and table tennis; owner, 2026-11-12 and 13). A
 * generic file: it names no sport. The rule is never ours: for each side it folds the stream with one more point for
 * that side, through the sport's own engine module, and reads whether that point closes the game and whether it
 * decides the match. 21, 15, 11, win by 2, the cap and best-of are all the engine's.
 */
export type PointCall = 'game' | 'match' | 'golden';

/** The words a call is drawn and said in: shared, the two sports call alike (`scoring.pad.call.*`). */
export type PadCallKey =
  'scoring.pad.call.gamePoint' | 'scoring.pad.call.matchPoint' | 'scoring.pad.call.goldenPoint';

const CALL_KEY: Readonly<Record<PointCall, PadCallKey>> = {
  game: 'scoring.pad.call.gamePoint',
  match: 'scoring.pad.call.matchPoint',
  golden: 'scoring.pad.call.goldenPoint',
};

/** The half's plate for a call; none for no call, and none when the half takes no tap (nothing is called on a dead half). */
export function padCallOf(
  call: PointCall | null | undefined,
  tappable: boolean,
): PadCall<PadCallKey> | null {
  if (call == null || !tappable) return null;
  const words = { key: CALL_KEY[call] };
  return { text: words, said: words };
}

export type PointCalls = {
  readonly calls: Readonly<Record<PadSide, PointCall | null>>;
  /**
   * The name (never the message, which can quote the server's bytes) of what the engine threw that was not its own
   * refusal, else null. A throw draws no plate; the hook that owns the logger says it once.
   */
  readonly fault: string | null;
};

export const NO_CALLS: PointCalls = { calls: { first: null, second: null }, fault: null };

/** What the stream gives the helper: the sport's engine module and rally type, and the match as the fold has it. */
export type PointCallInput = {
  readonly module: FoldableModule<SetBasedCfg, SetBasedState>;
  readonly rally: string;
  readonly engine: SetBasedEngineMatch;
  /** The entrant behind each half. */
  readonly entrants: Readonly<Record<PadSide, string>>;
  readonly envelopes: readonly EventEnvelope[];
  readonly state: Readonly<SetBasedState>;
  /** Badminton's BWF 29-29: when the next point wins the game whoever takes it, both sides are called golden. */
  readonly golden: boolean;
};

/** The calls for a folded match: the sport's engine module and rally event, and whether it has the golden point. */
export function pointCallsFrom(
  events: SetBasedEvents,
  folding: SetBasedFolding<unknown>,
  golden: boolean,
): PointCalls {
  const { seats, engine } = folding.match;
  return pointCallsOf({
    module: events.module,
    rally: events.rally,
    engine,
    entrants: { first: seats.first.entrantId, second: seats.second.entrantId },
    envelopes: folding.stream.envelopes,
    state: folding.folded.state,
    golden,
  });
}

const SIDES: readonly PadSide[] = ['first', 'second'];

type Effect = { readonly game: boolean; readonly match: boolean };

export function pointCallsOf(input: PointCallInput): PointCalls {
  const { state } = input;
  if (state.outcome !== null || state.phase !== 'live') return NO_CALLS;
  const effects: Record<PadSide, Effect> = { first: NONE, second: NONE };
  for (const side of SIDES) {
    const outcome = effectOf(input, side);
    if (typeof outcome === 'string') return { calls: NO_CALLS.calls, fault: outcome };
    effects[side] = outcome;
  }
  return {
    calls: { first: callOf(input, effects, 'first'), second: callOf(input, effects, 'second') },
    fault: null,
  };
}

const NONE: Effect = { game: false, match: false };

function callOf(
  input: { readonly golden: boolean },
  effects: Readonly<Record<PadSide, Effect>>,
  side: PadSide,
): PointCall | null {
  const mine = effects[side];
  if (mine.match) return 'match';
  const both = effects.first.game && effects.second.game;
  if (input.golden && both) return 'golden';
  return mine.game ? 'game' : null;
}

/** What one more point for `side` would do, or the name of the engine's fault (a refusal is not one: it does nothing). */
function effectOf(input: PointCallInput, side: PadSide): Effect | string {
  const { envelopes, engine, state } = input;
  const last = envelopes[envelopes.length - 1];
  const next: EventEnvelope = {
    id: `point-call:${side}`,
    fixtureId: engine.fixtureId,
    seq: (last?.seq ?? 0) + 1,
    type: input.rally,
    payload: { wonBy: input.entrants[side] },
    recordedAt: last?.recordedAt ?? new Date(0).toISOString(),
    recordedBy: null,
  };
  try {
    const after = foldMatch(input.module, engine.cfg, engine.lineups, [...envelopes, next], {
      strictFromSeq: next.seq,
    });
    const closed = (of: SetBasedState) => of.sets.filter((set) => set.closed).length;
    return { game: closed(after) > closed(state), match: after.outcome !== null };
  } catch (error) {
    if (EngineError.is(error)) return NONE;
    return error instanceof Error ? error.name : typeof error;
  }
}
