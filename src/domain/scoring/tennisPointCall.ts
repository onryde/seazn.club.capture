import { EngineError, foldMatch, type EventEnvelope } from '@seazn/engine/core';
import type { NestedState } from '@seazn/engine/sports/nested';
import { tennis } from '@seazn/engine/sports/tennis';
import type { PadCall, PadSide } from '@/domain/scoring/padView';
import type { TennisEngineMatch } from '@/domain/scoring/tennisEngine';

/**
 * Which side has break point, set point or match point (tennis; owner, 2026-11-13), badminton's and table tennis's point
 * calls (`setBasedPointCall`) over the nested kernel, which is not set-based and so has a helper of its own. The rule is
 * never ours: for each side it folds the stream with one more point for that side through the engine's tennis module and
 * reads what that point does. 15/30/40, deuce, no-ad, the tie-breaks, the sets, the best of and the final-set format are
 * all the engine's.
 */
export type TennisPointCall = 'break' | 'set' | 'match';

/** The words a call is drawn and said in; `matchPoint` is shared with badminton and table tennis (`scoring.pad.call.*`). */
export type TennisCallKey =
  'scoring.pad.call.breakPoint' | 'scoring.pad.call.setPoint' | 'scoring.pad.call.matchPoint';

const CALL_KEY: Readonly<Record<TennisPointCall, TennisCallKey>> = {
  break: 'scoring.pad.call.breakPoint',
  set: 'scoring.pad.call.setPoint',
  match: 'scoring.pad.call.matchPoint',
};

/** The half's plate for a call; none for no call, and none when the half takes no tap (nothing is called on a dead half). */
export function tennisCallPlate(
  call: TennisPointCall | null | undefined,
  tappable: boolean,
): PadCall<TennisCallKey> | null {
  if (call == null || !tappable) return null;
  const words = { key: CALL_KEY[call] };
  return { text: words, said: words };
}

export type TennisPointCalls = {
  readonly calls: Readonly<Record<PadSide, TennisPointCall | null>>;
  /**
   * The name (never the message, which can quote the server's bytes) of what the engine threw that was not its own
   * refusal, else null. A throw draws no plate; the hook that owns the logger says it once.
   */
  readonly fault: string | null;
};

export const NO_TENNIS_CALLS: TennisPointCalls = {
  calls: { first: null, second: null },
  fault: null,
};

/** What the fold gives the helper: the match, the stream and the state it folded to. */
export type TennisPointCallInput = {
  readonly engine: TennisEngineMatch;
  /** The entrant behind each half. */
  readonly entrants: Readonly<Record<PadSide, string>>;
  readonly envelopes: readonly EventEnvelope[];
  readonly state: Readonly<NestedState>;
  /** The engine's serving side (what the SERVING plate reads), or null when it cannot name one: nobody is the receiver then. */
  readonly serving: PadSide | null;
};

const SIDES: readonly PadSide[] = ['first', 'second'];
type Effect = { readonly game: boolean; readonly set: boolean; readonly match: boolean };

const NONE: Effect = { game: false, set: false, match: false };

/** The calls for a match on the pad: none unless the match is live (the caller adds its own "takes no tap" rules). */
export function tennisPointCallsOf(input: TennisPointCallInput): TennisPointCalls {
  const { state } = input;
  if (state.outcome !== null || state.phase !== 'live') return NO_TENNIS_CALLS;
  const calls: Record<PadSide, TennisPointCall | null> = { first: null, second: null };
  for (const side of SIDES) {
    const effect = effectOf(input, side);
    if (typeof effect === 'string') return { calls: NO_TENNIS_CALLS.calls, fault: effect };
    calls[side] = callOf(effect, input.serving, side);
  }
  return { calls, fault: null };
}

/**
 * A side's call: match point where its point decides the match, else set point where it wins a set, else break point where it
 * wins a game as the receiver. The server's plain game point has no call. A tie-break (and a match tie-break) has no break
 * point without a guard of ours: its only game is the set (or the match), which the two calls above already took.
 */
function callOf(effect: Effect, serving: PadSide | null, side: PadSide): TennisPointCall | null {
  if (effect.match) return 'match';
  if (effect.set) return 'set';
  const receiver = serving !== null && serving !== side;
  return effect.game && receiver ? 'break' : null;
}

/** What one more point for `side` would do, or the name of the engine's fault (a refusal is not one: it does nothing). */
function effectOf(input: TennisPointCallInput, side: PadSide): Effect | string {
  const { envelopes, engine, state } = input;
  const last = envelopes[envelopes.length - 1];
  const next: EventEnvelope = {
    id: `point-call:${side}`,
    fixtureId: engine.fixtureId,
    seq: (last?.seq ?? 0) + 1,
    type: 'tennis.point',
    payload: { by: input.entrants[side] },
    recordedAt: last?.recordedAt ?? new Date(0).toISOString(),
    recordedBy: null,
  };
  try {
    const after = foldMatch(tennis, engine.cfg, engine.lineups, [...envelopes, next], {
      strictFromSeq: next.seq,
    });
    const set = after.sets.length > state.sets.length;
    const game = set || after.games.home + after.games.away > state.games.home + state.games.away;
    const match = after.outcome !== null || after.phase === 'done' || after.phase === 'final';
    return { game, set, match };
  } catch (error) {
    if (EngineError.is(error)) return NONE;
    return error instanceof Error ? error.name : typeof error;
  }
}
