import type { QueuedEvent, MatchQueue } from '@/domain/scoring/queue';
import {
  openMatch,
  step,
  type MatchEffect,
  type MatchEvent,
  type MatchHeld,
  type MatchState,
  type MatchStep,
} from '@/domain/scoring/scoringMatch';
import { SINGLES, ledgerOf, start, type Spec } from './badmintonLedger';

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
  queue: queueOf(),
  ledger: ledgerOf([start()]),
  bootstrap: SINGLES,
  toss: null,
  judge: 'fold',
  foreground: true,
  rulesVersion: 1,
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
export function drive(
  from: MatchState,
  events: readonly MatchEvent[],
  now = NOW,
): { state: MatchState; steps: readonly MatchStep[] } {
  let state = from;
  const steps: MatchStep[] = [];
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
