import { describe, expect, it } from 'vitest';
import { foldMemo } from '@/domain/scoring/scoringMatchFold';
import { SINGLES, ledgerOf, queuedOf, rally, start } from '../../../test/badmintonLedger';

// The fold is remembered while its inputs have not moved (plan S2-1 Task 9). A hit is the same object a fresh fold would
// give, so a caller that asks twice folds once.
const LEDGER = ledgerOf([start()]);
const INPUT = {
  bootstrap: SINGLES,
  ledger: LEDGER,
  queued: [],
  ownEventIds: [],
  toss: null,
} as const;

describe('foldMemo', () => {
  it('answers the same fold, the same object, to the same input', () => {
    expect(foldMemo(INPUT)).toBe(foldMemo({ ...INPUT }));
  });

  it('answers the same fold to lists of the same members in new arrays', () => {
    const queued = [queuedOf('k1', rally('H'))];
    const first = foldMemo({ ...INPUT, queued, ownEventIds: ['a'] });
    expect(foldMemo({ ...INPUT, queued: [...queued], ownEventIds: ['a'] })).toBe(first);
  });

  it.each([
    ['the bootstrap', { bootstrap: { ...SINGLES } }],
    ['the ledger', { ledger: ledgerOf([start(), rally('A')]) }],
    ['the queue', { queued: [queuedOf('k1', rally('H'))] }],
    ['the own ids', { ownEventIds: ['ev-1'] }],
    ['the pick', { toss: 'first' as const }],
  ])('folds again when %s has moved', (_name, change) => {
    const before = foldMemo(INPUT);
    expect(foldMemo({ ...INPUT, ...change })).not.toBe(before);
  });

  it('keeps one entry: asking another input then the first again folds again', () => {
    const first = foldMemo(INPUT);
    foldMemo({ ...INPUT, toss: 'second' });
    expect(foldMemo(INPUT)).not.toBe(first);
  });

  it('a fold is what the engine says: the started match with one rally is 1:0', () => {
    const folded = foldMemo({ ...INPUT, queued: [queuedOf('k1', rally('H'))] });
    expect(folded.kind === 'folded' && folded.display.points).toEqual({ first: 1, second: 0 });
  });
});
