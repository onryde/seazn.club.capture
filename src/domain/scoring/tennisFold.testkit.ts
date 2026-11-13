import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import { foldTennis } from '@/domain/scoring/tennisFold';
import type { TennisDisplay } from '@/domain/scoring/tennisTypes';
import type { Bootstrap } from '@/domain/scoring/wire';
import { SINGLES, game, judgedLedgerOf, type Spec } from '../../../test/tennisLedger';

/** The fold of a ledger the real engine took, with this phone's queued taps on top. */
export function fold(
  specs: readonly Spec[],
  more: {
    readonly queued?: readonly QueuedEvent[];
    readonly bootstrap?: Bootstrap;
  } = {},
) {
  const bootstrap = more.bootstrap ?? SINGLES;
  const input: SportFoldInput = {
    bootstrap,
    ledger: judgedLedgerOf(bootstrap, specs),
    queued: more.queued ?? [],
    ownEventIds: [],
    toss: null,
  };
  return foldTennis(input);
}

export function folded(...args: Parameters<typeof fold>) {
  const result = fold(...args);
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result;
}

/** The fold of a bootstrap the engine cannot be built from: no ledger, so nothing is judged first. */
export const foldBare = (bootstrap: Bootstrap) =>
  foldTennis({ bootstrap, ledger: [], queued: [], ownEventIds: [], toss: null });

export const display = (...args: Parameters<typeof fold>): TennisDisplay => folded(...args).display;

/** Love games, one letter each: `H` to home, `A` to away. */
export const gamesOf = (winners: string): Spec[] =>
  [...winners].flatMap((letter) => game(letter === 'H' ? 'H' : 'A'));

export const sideOf = (seat: 'H' | 'A'): PadSide => (seat === 'H' ? 'first' : 'second');
