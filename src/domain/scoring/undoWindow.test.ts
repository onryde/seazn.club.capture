import { describe, expect, it } from 'vitest';
import type { PadLastTap, PadStateCard, PadView } from '@/domain/scoring/padView';
import { undoWindowChangesAt, undoWindowLeft, withUndoWindow } from '@/domain/scoring/undoWindow';

// Owner, 2026-11-03: Undo closes 45 s after a match is decided by this phone's own tap, with a countdown. The rule is
// whole seconds, rounded up; every number below is written out, none computed from the code under test.

describe('undoWindowLeft', () => {
  it.each([
    [0, 45],
    [1, 45],
    [999, 45],
    [1_000, 44],
    [1_001, 44],
    [14_999, 31],
    [15_000, 30],
    [29_999, 16],
    [30_000, 15],
    [44_000, 1],
    [44_001, 1],
    [44_999, 1],
  ])('has %i ms gone with %i s left', (gone, left) => {
    expect(undoWindowLeft(10_000, 10_000 + gone)).toBe(left);
  });

  it.each([45_000, 45_001, 60_000, 3_600_000])('is closed once %i ms have gone', (gone) => {
    expect(undoWindowLeft(10_000, 10_000 + gone)).toBeNull();
  });

  it('is closed when there is no window', () => {
    expect(undoWindowLeft(null, 10_000)).toBeNull();
    expect(undoWindowLeft(null, 0)).toBeNull();
  });

  // The phone's clock set back (a network time sync) must not give more than the window.
  it.each([-1, -1_000, -44_999, -45_000, -3_600_000])(
    'never gives more than 45 when the clock is %i ms before the start',
    (gone) => {
      expect(undoWindowLeft(10_000_000, 10_000_000 + gone)).toBe(45);
    },
  );

  it('counts from a start at zero too', () => {
    expect(undoWindowLeft(0, 0)).toBe(45);
    expect(undoWindowLeft(0, 44_001)).toBe(1);
    expect(undoWindowLeft(0, 45_000)).toBeNull();
  });
});

// The moment the seconds on the card next change, which is the moment a timer is set for: so the last change is the
// close itself, to the millisecond, and every digit changes as it is due, never a tick late.
describe('undoWindowChangesAt', () => {
  it.each([
    [0, 11_000],
    [1, 11_000],
    [999, 11_000],
    [1_000, 12_000],
    [1_001, 12_000],
    [14_999, 25_000],
    [15_000, 26_000],
    [28_999, 39_000],
    [29_000, 40_000],
    [29_999, 40_000],
    [43_999, 54_000],
    [44_000, 55_000],
    [44_999, 55_000],
  ])('with %i ms gone it is %i on the phone’s clock', (gone, at) => {
    expect(undoWindowChangesAt(10_000, 10_000 + gone)).toBe(at);
  });

  it.each([45_000, 45_001, 3_600_000])('has no next change once %i ms have gone', (gone) => {
    expect(undoWindowChangesAt(10_000, 10_000 + gone)).toBeNull();
  });

  it('has none when there is no window', () => {
    expect(undoWindowChangesAt(null, 10_000)).toBeNull();
  });

  it('counts from the start when the clock was set back before it', () => {
    expect(undoWindowChangesAt(10_000, 4_000)).toBe(11_000);
  });
});

const recorded = (undoLeft: number | null): PadStateCard => ({ kind: 'resultRecorded', undoLeft });
const OWN = { text: { key: 'k.x' }, undo: true } as const;
const NOT_OWN = { text: { key: 'k.x' }, undo: false } as const;

describe('withUndoWindow', () => {
  const text = { key: 'k.x' } as const;
  const half = (side: 'first' | 'second'): PadView<'k.x'>['halves'][0] => ({
    side,
    label: side,
    value: '21',
    periods: null,
    sub: null,
    marks: { clock: false, cards: [], said: [] },
    serving: null,
    plate: null,
    action: null,
    bar: 'dim',
    hint: text,
    tappable: false,
  });
  const view = (
    card: PadStateCard | null,
    lastTap: PadLastTap<'k.x'> | null = OWN,
  ): PadView<'k.x'> => ({
    halves: [half('first'), half('second')],
    tally: { shown: '1:0', said: text },
    details: {
      context: { competition: 'Open', division: null, round: null, match: null, sides: ['A', 'B'] },
      rules: [],
    },
    start: null,
    strip: [],
    lastTap,
    sync: { kind: 'synced' },
    tools: [],
    card,
  });

  it('puts the seconds left on the result card and keeps Undo while the window is open', () => {
    const windowed = withUndoWindow(view(recorded(null)), 17);
    expect(windowed.card).toEqual({ kind: 'resultRecorded', undoLeft: 17 });
    expect(windowed.lastTap).toEqual(OWN);
    expect(windowed.halves.map((half) => half.value)).toEqual(['21', '21']);
  });

  it('closes the card and takes Undo off when the window is closed', () => {
    const windowed = withUndoWindow(view(recorded(12)), null);
    expect(windowed.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(windowed.lastTap).toEqual({ ...OWN, undo: false });
  });

  // Undo was never offered (the other scorer's result): a window left over from earlier cannot offer it.
  it('does not open a window for a result whose Undo is off', () => {
    const windowed = withUndoWindow(view(recorded(null), NOT_OWN), 20);
    expect(windowed.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(windowed.lastTap?.undo).toBe(false);
  });

  it('has no last tap to hold Undo when there is none', () => {
    const windowed = withUndoWindow(view(recorded(null), null), 20);
    expect(windowed.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(windowed.lastTap).toBeNull();
  });

  it.each([
    null,
    { kind: 'viewOnly' },
    { kind: 'notStarted' },
    { kind: 'linkInvalid' },
    { kind: 'updateNeeded', unsent: 2 },
  ] as const)('leaves a pad whose card is %j as it is', (card) => {
    const plain = view(card);
    expect(withUndoWindow(plain, 20)).toBe(plain);
    expect(withUndoWindow(plain, null)).toBe(plain);
  });
});
