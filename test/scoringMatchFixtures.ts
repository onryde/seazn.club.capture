import { badmintonSport, type BadmintonTypes } from '@/domain/scoring/badmintonSport';
import type { QueuedEvent, MatchQueue } from '@/domain/scoring/queue';
import type { SportTypes } from '@/domain/scoring/scoringSport';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type {
  MatchEffect,
  MatchEvent as AnyMatchEvent,
  MatchHeld as AnyMatchHeld,
  MatchState as AnyMatchState,
  MatchStep as AnyMatchStep,
} from '@/domain/scoring/scoringMatchState';
import { SINGLES, ledgerOf, queuedOf, rally, start, type Spec } from './badmintonLedger';

/** The reducer's types, for the badminton matches these fixtures open. */
type MatchHeld = AnyMatchHeld<BadmintonTypes>;
type MatchState = AnyMatchState<BadmintonTypes>;

/**
 * Literal inputs for the match reducer's tests (plan S2-1 Task 9). A match is opened from what the disk would hold, and
 * driven by events; every expectation is written out in the test, never computed by the reducer.
 */
export const NOW = 1_000_000;
export const FIXTURE = 'fx-1';

export const queueOf = (over: Partial<MatchQueue> = {}): MatchQueue => ({
  fixtureId: FIXTURE,
  label: 'A. Sharma v L. Chen',
  pending: [],
  ownEventIds: [],
  dead: null,
  ...over,
});

export const held = (over: Partial<MatchHeld> = {}): MatchHeld => ({
  sport: badmintonSport,
  queue: queueOf(),
  ledger: ledgerOf([start()]),
  bootstrap: SINGLES,
  toss: null,
  judge: 'fold',
  foreground: true,
  rulesVersion: 1,
  decidedAt: null,
  ...over,
});

/** A match opened from disk, its first reads not yet answered. */
export function opened(over: Partial<MatchHeld> = {}, specs?: readonly Spec[]): MatchState {
  const base = held(over);
  return openMatch(specs === undefined ? base : { ...base, ledger: ledgerOf(specs) }, NOW).state;
}

/**
 * A match opened and its first reads answered with nothing new: the state a scorer finds. A queue with taps in it has
 * been judged and its head sent by then (the effects are not kept): use `opened` to watch that step.
 */
export function ready(over: Partial<MatchHeld> = {}, specs?: readonly Spec[]): MatchState {
  const base = held(over);
  const opened = openMatch(specs === undefined ? base : { ...base, ledger: ledgerOf(specs) }, NOW);
  return step(opened.state, { kind: 'fetched', events: [] }, NOW).state;
}

export const tapped = (queue: readonly QueuedEvent[]): Partial<MatchHeld> => ({
  queue: queueOf({ pending: queue }),
});

/** Runs the events in order on the latest state; returns the state and every step's effects and outcome. */
export function drive<S extends SportTypes>(
  from: AnyMatchState<S>,
  events: readonly AnyMatchEvent<S>[],
  now = NOW,
): { state: AnyMatchState<S>; steps: readonly AnyMatchStep<S>[] } {
  let state = from;
  const steps: AnyMatchStep<S>[] = [];
  for (const event of events) {
    const next = step(state, event, now);
    steps.push(next);
    state = next.state;
  }
  return { state, steps };
}

export const kinds = (effects: readonly MatchEffect[]): readonly string[] =>
  effects.map((effect) => effect.kind);

export const sendsOf = (effects: readonly MatchEffect[]) =>
  effects.flatMap((effect) => (effect.kind === 'send' ? [effect] : []));

export const savesOf = (effects: readonly MatchEffect[]) =>
  effects.flatMap((effect) => (effect.kind === 'save' ? [effect] : []));

/** The moment the reducer's tests tap at. */
export const AT = '2026-11-02T09:00:00.000Z';

/** A match whose one queued rally (`k1`) has been sent at seq 1 and is awaiting its answer. */
export function sentOnce(extra: readonly QueuedEvent[] = []) {
  const queue = [queuedOf('k1', rally('H')), ...extra];
  const read = step(opened(tapped(queue)), { kind: 'fetched', events: [] }, NOW);
  // The runner dispatches `saved` when the attempt's save lands, and only then makes the call.
  const saved = step(read.state, { kind: 'saved', n: 99 }, NOW);
  return { state: saved.state, sent: sendsOf(read.effects)[0].sent };
}

/** The server's answer to the first rally when it lands at seq 2. */
export const ACCEPTED = { kind: 'accepted', seq: 2, eventId: 'srv-1', rulesVersion: 1 } as const;
