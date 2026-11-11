import { foldFootball } from '@/domain/scoring/footballFold';
import type { FootballDisplay, FootballTypes } from '@/domain/scoring/footballTypes';
import type { PadHistoryGroup } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  at,
  card,
  clock,
  goal,
  kick,
  ledgerOf,
  MATCH,
  period,
  start,
  type Spec,
} from './footballLedger';

/**
 * Football matches at the moments the pad tests look at (S2-5 plan P Task 8), folded by the real fold. Only the ledgers
 * are written here; every expected view is written out in the test that asserts it.
 */

export const H = (n: number) => `H-p${n}`;
export const A = (n: number) => `A-p${n}`;

type Folding = {
  readonly queued?: readonly QueuedEvent[];
  readonly ownEventIds?: readonly string[];
};

function folded(specs: readonly Spec[], bootstrap: Bootstrap, more: Folding) {
  const fold = foldFootball({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: more.queued ?? [],
    ownEventIds: more.ownEventIds ?? [],
    toss: null,
  });
  if (fold.kind !== 'folded') throw new Error(`unfoldable: ${fold.reason}`);
  return fold;
}

/** The display a ledger folds to. */
export const displayOf = (
  specs: readonly Spec[],
  bootstrap: Bootstrap = MATCH,
  more: Folding = {},
): FootballDisplay => folded(specs, bootstrap, more).display;

/** History as the fold builds it. */
export const historyOf = (
  specs: readonly Spec[],
  bootstrap: Bootstrap = MATCH,
  more: Folding = {},
): readonly PadHistoryGroup<FootballTypes['padKey']>[] => folded(specs, bootstrap, more).history;

/** Kick-off: the start, then the clock running from 0. */
export const KICK_OFF: readonly Spec[] = [start(), clock(true, at('H1', 0))];

/** Five goals each in the first half (home, then away, every two minutes). */
const FIVE_ALL: readonly Spec[] = Array.from({ length: 5 }, (_, i) => [
  goal({ by: 'H', at: at('H1', 240 * i + 60) }),
  goal({ by: 'A', at: at('H1', 240 * i + 180) }),
]).flat();

/** 5–5 through 90 minutes and extra time, so the kicks decide it. */
export const LEVEL_AFTER_ET: readonly Spec[] = [
  ...KICK_OFF,
  ...FIVE_ALL,
  period('HT', at('H1', 2700)),
  clock(true, at('H2', 0)),
  period('FT', at('H2', 2700)),
  clock(true, at('ET_H1', 0)),
  period('ET_HT', at('ET_H1', 900)),
  clock(true, at('ET_H2', 0)),
  period('ET_FT', at('ET_H2', 900)),
];

/** Kicks in order, home first: `'H+'` scored, `'A-'` missed. */
export const kicks = (marks: string): readonly Spec[] =>
  marks
    .split(' ')
    .map((mark) => kick({ by: mark[0] === 'H' ? 'H' : 'A', scored: mark[1] === '+' }));

/** Home 4 of 4, away 3 of 3: undecided, away to kick. */
export const KICKS_4_3: readonly Spec[] = [...LEVEL_AFTER_ET, ...kicks('H+ A+ H+ A+ H+ A+ H+')];

/** Home 4, away 1 after four rounds: away can no longer catch up, so home's fourth kick decides it. */
export const KICKS_4_1: readonly Spec[] = [...LEVEL_AFTER_ET, ...kicks('H+ A+ H+ A- H+ A- H+')];

/** Kick-off, then the home side's number 4 shown a yellow (the fake's ids: `ent-home-p4`). */
export const YELLOWED_HOME_4: readonly Spec[] = [
  ...KICK_OFF,
  card({ by: 'H', color: 'yellow', person: 'ent-home-p4' }),
];

/** Kick-off, then all sixteen of the home side's players shown a red (the fake's ids: `ent-home-p1` to `p16`). */
export const ALL_HOME_SENT_OFF: readonly Spec[] = [
  ...KICK_OFF,
  ...Array.from({ length: 16 }, (_, i) =>
    card({ by: 'H', color: 'red', person: `ent-home-p${i + 1}` }),
  ),
];
