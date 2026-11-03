import { describe, expect, it } from 'vitest';
import type { PadLastTap, PadStateCard, PadView } from '@/domain/scoring/padView';
import {
  advanceUndoWindow,
  undoWindowLeft,
  withUndoWindow,
  type UndoWindowSeen,
} from '@/domain/scoring/undoWindow';

// Owner, 2026-11-03: Undo closes 30 s after a match is decided by this phone's own tap, with a countdown. The rule is
// whole seconds, rounded up; every number below is written out, none computed from the code under test.

describe('undoWindowLeft', () => {
  it.each([
    [0, 30],
    [1, 30],
    [999, 30],
    [1_000, 29],
    [1_001, 29],
    [14_999, 16],
    [15_000, 15],
    [29_000, 1],
    [29_001, 1],
    [29_999, 1],
  ])('has %i ms gone with %i s left', (gone, left) => {
    expect(undoWindowLeft(10_000, 10_000 + gone)).toBe(left);
  });

  it.each([30_000, 30_001, 60_000, 3_600_000])('is closed once %i ms have gone', (gone) => {
    expect(undoWindowLeft(10_000, 10_000 + gone)).toBeNull();
  });

  it('is closed when there is no window', () => {
    expect(undoWindowLeft(null, 10_000)).toBeNull();
    expect(undoWindowLeft(null, 0)).toBeNull();
  });

  // The phone's clock set back (a network time sync) must not give more than the window.
  it.each([-1, -1_000, -29_999, -30_000, -3_600_000])(
    'never gives more than 30 when the clock is %i ms before the start',
    (gone) => {
      expect(undoWindowLeft(10_000_000, 10_000_000 + gone)).toBe(30);
    },
  );

  it('counts from a start at zero too', () => {
    expect(undoWindowLeft(0, 0)).toBe(30);
    expect(undoWindowLeft(0, 29_001)).toBe(1);
    expect(undoWindowLeft(0, 30_000)).toBeNull();
  });
});

const recorded = (undoLeft: number | null): PadStateCard => ({ kind: 'resultRecorded', undoLeft });
const NONE: UndoWindowSeen = { phase: 'none', openedAt: null };
const PLAYING: UndoWindowSeen = { phase: 'playing', openedAt: null };
const OWN = { text: { key: 'k.x' }, undo: true } as const;
const NOT_OWN = { text: { key: 'k.x' }, undo: false } as const;
const pad = (card: PadStateCard | null, lastTap: PadLastTap<'k.x'> | null = OWN) => ({
  card,
  lastTap,
});

describe('advanceUndoWindow', () => {
  // The window opens when this phone first shows the decided state its own tap made: a match seen in play, then decided.
  it('opens at the moment a match in play is first shown decided with Undo on its own tap', () => {
    expect(advanceUndoWindow(PLAYING, pad(recorded(null)), 5_000)).toEqual({
      phase: 'decided',
      openedAt: 5_000,
    });
  });

  it('opens nothing when the first thing seen is already decided (after a restart, or a screen opened late)', () => {
    expect(advanceUndoWindow(NONE, pad(recorded(null)), 5_000)).toEqual({
      phase: 'decided',
      openedAt: null,
    });
  });

  it('opens nothing for a result another scorer made, which offers no Undo', () => {
    expect(advanceUndoWindow(PLAYING, pad(recorded(null), NOT_OWN), 5_000)).toEqual({
      phase: 'decided',
      openedAt: null,
    });
    expect(advanceUndoWindow(PLAYING, pad(recorded(null), null), 5_000).openedAt).toBeNull();
  });

  it('is the same object while nothing changes: a decided pad seen again does not start again', () => {
    const decided: UndoWindowSeen = { phase: 'decided', openedAt: 5_000 };
    expect(advanceUndoWindow(decided, pad(recorded(12)), 9_000)).toBe(decided);
    expect(advanceUndoWindow(PLAYING, pad(null), 9_000)).toBe(PLAYING);
  });

  it('keeps the window it has while the match is decided, whatever the clock says', () => {
    const decided: UndoWindowSeen = { phase: 'decided', openedAt: 5_000 };
    expect(advanceUndoWindow(decided, pad(recorded(null)), 99_000).openedAt).toBe(5_000);
  });

  // The next decision starts a fresh window: Undo reopened the match (a card of none), then it is decided again.
  it('starts a fresh window at the next decision after Undo reopened the match', () => {
    const decided: UndoWindowSeen = { phase: 'decided', openedAt: 5_000 };
    const reopened = advanceUndoWindow(decided, pad(null), 8_000);
    expect(reopened.phase).toBe('playing');
    expect(advanceUndoWindow(reopened, pad(recorded(null)), 20_000)).toEqual({
      phase: 'decided',
      openedAt: 20_000,
    });
  });

  // A card that is not the result (the organiser's lock, a dead link coming and going, a banner) neither opens a window
  // nor loses where the match stood, so a result that comes back under a flicker does not start again.
  it.each([
    { kind: 'viewOnly' },
    { kind: 'linkInvalid' },
    { kind: 'notStarted' },
    { kind: 'updateNeeded', unsent: 1 },
  ] as const)('does not mistake a $kind card for a match in play', (card) => {
    const decided: UndoWindowSeen = { phase: 'decided', openedAt: 5_000 };
    const covered = advanceUndoWindow(decided, pad(card), 8_000);
    expect(covered).toBe(decided);
    expect(advanceUndoWindow(covered, pad(recorded(null)), 40_000)).toBe(decided);
  });

  it('a match not yet started stays unseen, and Start shows it in play', () => {
    expect(advanceUndoWindow(NONE, pad({ kind: 'notStarted' }), 1_000)).toBe(NONE);
    expect(advanceUndoWindow(NONE, pad(null), 1_000).phase).toBe('playing');
  });
});

describe('withUndoWindow', () => {
  const text = { key: 'k.x' } as const;
  const half = (side: 'first' | 'second'): PadView<'k.x'>['halves'][0] => ({
    side,
    label: side,
    value: '21',
    periods: null,
    sub: null,
    serving: null,
    bar: 'dim',
    hint: text,
    hintLine: text,
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
