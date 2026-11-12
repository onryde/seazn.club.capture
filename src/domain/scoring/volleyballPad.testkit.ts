import type { PadSide, PadView } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { foldVolleyball } from '@/domain/scoring/volleyballFold';
import { volleyballPad } from '@/domain/scoring/volleyballPad';
import type { VolleyballDisplay, VolleyballPadKey } from '@/domain/scoring/volleyballTypes';
import type { Bootstrap } from '@/domain/scoring/wire';
import { INDOOR, judgedLedgerOf, rally, start, type Spec } from '../../../test/volleyballLedger';

/**
 * The display of a ledger (judged by the real engine) and the pad drawn from it, for the pad's tests: the display is the
 * fold's, never a hand-made one, so a flag a test reads is one a server would hold.
 */
export function displayOf(
  specs: readonly Spec[],
  more: {
    readonly bootstrap?: Bootstrap;
    readonly toss?: PadSide | null;
    readonly queued?: readonly QueuedEvent[];
  } = {},
): VolleyballDisplay {
  const bootstrap = more.bootstrap ?? INDOOR;
  const result = foldVolleyball({
    bootstrap,
    ledger: judgedLedgerOf(bootstrap, specs),
    queued: more.queued ?? [],
    ownEventIds: [],
    toss: more.toss ?? null,
  });
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result.display;
}

export const padOf = (...args: Parameters<typeof displayOf>): PadView<VolleyballPadKey> =>
  volleyballPad(displayOf(...args));

/** Started, home serving, one rally in: a set under way. */
export const LIVE: readonly Spec[] = [start(), rally({ wonBy: 'H', serving: 'H' })];

/** One set to `to` for `winner`; the first rally names the first server when `serving` is given. */
export const wonSet = (winner: 'H' | 'A', serving?: 'H' | 'A', to = 25): Spec[] => [
  rally({ wonBy: winner, ...(serving === undefined ? {} : { serving }) }),
  ...Array.from({ length: to - 1 }, () => rally({ wonBy: winner })),
];
