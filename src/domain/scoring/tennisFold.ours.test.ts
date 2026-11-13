import { describe, expect, it, vi } from 'vitest';
import { foldTennis } from '@/domain/scoring/tennisFold';
import { SINGLES, ledgerOf, start } from '../../../test/tennisLedger';

// S2-7 B3 fix round (review I2): a throw from this build's own code inside the fold is a bug, not an unreadable ledger, and
// must not be dressed up as "can't be worked out". The engine's fold is stood in for here so that it hands the callback a
// state our code cannot read (an engine shape change on a version bump); the sibling folds rethrow what is not the engine's.

const state = vi.hoisted(() => ({ shape: 'broken' as 'broken' | 'real' }));

vi.mock('@seazn/engine/core', async (importActual) => {
  const actual = await importActual<typeof import('@seazn/engine/core')>();
  return {
    ...actual,
    foldMatchWithStoppage: (...args: Parameters<typeof actual.foldMatchWithStoppage>) => {
      if (state.shape === 'real') return actual.foldMatchWithStoppage(...args);
      const options = args[4];
      const events = args[3];
      // No `sets` and no `games`: reading them is a TypeError in OUR callback.
      options?.onFolded?.({} as never, events[0] as never, {} as never);
      throw new Error('unreachable');
    },
  };
});

describe('a bug in the fold’s own callback', () => {
  const input = {
    bootstrap: SINGLES,
    ledger: ledgerOf([start()]),
    queued: [],
    ownEventIds: [],
    toss: null,
  };

  it('is rethrown, not answered as an unfoldable ledger', () => {
    expect(() => foldTennis(input)).toThrow(TypeError);
  });

  it('and the same input folds when the engine hands the callback a real state', () => {
    state.shape = 'real';
    expect(foldTennis(input)).toMatchObject({ kind: 'folded' });
    state.shape = 'broken';
  });
});
