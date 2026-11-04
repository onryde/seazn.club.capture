import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadStateCard, PadView } from '@/domain/scoring/padView';
import { PortsProvider, type Ports } from '@/hooks/usePorts';
import { useUndoWindow } from '@/hooks/useUndoWindow';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import { createFakePorts, timerClock } from '../../test/fakePorts';

// Owner, 2026-11-03: Undo closes 45 s after a match is decided by this phone's own tap, with a countdown. The window's
// start comes with the pad (`MatchPad.decidedAt`: the reducer's, `scoringMatchWindow.ts`, kept by the hub); the hook
// counts it down on the phone's clock and applies it to the pad. These tests drive it with pads made by hand, on a clock
// moved by fake timers. The reducer, the hub, the match hook and the screen are tested over it elsewhere.

type Types = {
  readonly tap: unknown;
  readonly display: unknown;
  readonly padKey: 'k.x';
  readonly undone: unknown;
};
type Pad = MatchPad<Types>;

const TEXT = { key: 'k.x' } as const;
const OWN = { text: TEXT, undo: true } as const;
const NOT_OWN = { text: TEXT, undo: false } as const;

/** A pad with the card and last tap given; the rest is whatever a pad needs to be one. */
function padWith(card: PadStateCard | null, lastTap: PadView<'k.x'>['lastTap'] = OWN): Pad {
  const half = (side: 'first' | 'second'): PadView<'k.x'>['halves'][0] => ({
    side,
    label: side,
    value: '21',
    periods: null,
    sub: null,
    marks: { clock: false, cards: [], said: [] },
    serving: null,
    bar: 'dim',
    hint: TEXT,
    tappable: false,
  });
  return {
    kind: 'pad',
    view: {
      halves: [half('first'), half('second')],
      tally: { shown: '0:0', said: TEXT },
      details: {
        context: {
          competition: 'Open',
          division: null,
          round: null,
          match: null,
          sides: ['A', 'B'],
        },
        rules: [],
      },
      start: null,
      strip: [],
      lastTap,
      sync: { kind: 'synced' },
      tools: [],
      card,
    },
    display: null,
    history: [],
    line: null,
    toss: null,
    ask: null,
    decidedAt: null,
  };
}

const RESULT = { kind: 'resultRecorded', undoLeft: null } as const;
const PLAYING = padWith(null);
/** This phone's own tap decided the match `ago` ms before the clock now reads. */
const decidedAgo = (ago: number, lastTap: PadView<'k.x'>['lastTap'] = OWN): Pad => ({
  ...padWith(RESULT, lastTap),
  decidedAt: Date.now() - ago,
});
const DECIDED_BY_OTHER = padWith(RESULT, NOT_OWN);

/** The hook mounted on a screen whose first pad is `pad` (a match in play unless said). */
function setUp(ports: Ports, options: { strict?: boolean; pad?: Pad | null } = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    const tree = <PortsProvider ports={ports}>{children}</PortsProvider>;
    return options.strict ? <StrictMode>{tree}</StrictMode> : tree;
  }
  return renderHook((props: { pad: Pad | null }) => useUndoWindow(ports, props.pad), {
    wrapper: Wrapper,
    initialProps: { pad: options.pad === undefined ? PLAYING : options.pad },
  });
}

type Mounted = ReturnType<typeof setUp>;
const card = (mounted: Mounted) => mounted.result.current?.view.card;
const undoOf = (mounted: Mounted) => mounted.result.current?.view.lastTap?.undo;
const left = (mounted: Mounted) => {
  const shown = card(mounted);
  return shown?.kind === 'resultRecorded' ? shown.undoLeft : 'no result card';
};
/**
 * Time passing, a second at a time at most: the card's timer is set again by the render its own firing causes, and
 * React flushes that render when the `act` ends, so one `act` over a long wait would run one hop of the chain only.
 */
async function wait(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 1_000) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(left, 1_000)));
  }
}
const show = (mounted: Mounted, pad: Pad | null) => act(() => mounted.rerender({ pad }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T10:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

/** The fake engine ticks a heartbeat of its own: the timers a test counts are the ones above this baseline. */
let baseline = 0;
const phone = () => {
  const ports = createFakePorts({ clock: timerClock }).ports;
  baseline = vi.getTimerCount();
  return ports;
};
const timers = () => vi.getTimerCount() - baseline;

describe('the window of a match decided by this phone’s own tap', () => {
  it('is at 45 the moment the decision is shown, and counts down a second at a time', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(0) });
    expect(left(mounted)).toBe(45);
    expect(undoOf(mounted)).toBe(true);
    await wait(999);
    expect(left(mounted)).toBe(45);
    await wait(1);
    expect(left(mounted)).toBe(44);
    await wait(14_000);
    expect(left(mounted)).toBe(30);
    await wait(14_000);
    expect(left(mounted)).toBe(16);
    await wait(15_000);
    expect(left(mounted)).toBe(1);
    expect(undoOf(mounted)).toBe(true);
  });

  // The start is the tap's, not the screen's: a pad shown 400 ms after the tap changes its digit 600 ms later, and a
  // timer started with the screen would be 400 ms late every second.
  it('counts from the tap, not from when the screen drew it: the digit changes on the tap’s own second', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(400) });
    expect(left(mounted)).toBe(45);
    await wait(599);
    expect(left(mounted)).toBe(45);
    await wait(1);
    expect(left(mounted)).toBe(44);
    await wait(999);
    expect(left(mounted)).toBe(44);
    await wait(1);
    expect(left(mounted)).toBe(43);
  });

  it('closes at the 45 s to the millisecond: a timer set for the close itself, not a tick that comes near it', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(250) });
    await wait(44_749);
    expect(left(mounted)).toBe(1);
    expect(undoOf(mounted)).toBe(true);
    await wait(1);
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
  });

  it('stays closed once closed, however long the pad stays', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(0) });
    await wait(45_000);
    await wait(120_000);
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
  });

  it('reads the phone’s clock, not the count of ticks: a phone asleep for a minute comes back closed', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(0) });
    await wait(2_000);
    expect(left(mounted)).toBe(43);
    // Timers stand still while the app sleeps; the wall clock does not.
    vi.setSystemTime(Date.now() + 60_000);
    await wait(1_000);
    expect(left(mounted)).toBeNull();
  });

  it('is closed at once on a screen opened after the window ran out, and starts nothing', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(46_000) });
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
    expect(timers()).toBe(0);
  });

  it('counts the rest of a window that was already running when the screen opened (Home and back)', async () => {
    // 33.3 s gone: past the 30 s the window first had, so a longer one is what is counted.
    const mounted = setUp(phone(), { pad: decidedAgo(33_300) });
    expect(left(mounted)).toBe(12);
    await wait(699);
    expect(left(mounted)).toBe(12);
    await wait(1);
    expect(left(mounted)).toBe(11);
  });

  it('starts a fresh 45 s at the next decision after Undo reopened the match', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(0) });
    await wait(10_000);
    expect(left(mounted)).toBe(35);
    await show(mounted, PLAYING);
    expect(card(mounted)).toBeNull();
    await wait(5_000);
    await show(mounted, decidedAgo(0));
    expect(left(mounted)).toBe(45);
    await wait(3_000);
    expect(left(mounted)).toBe(42);
  });

  it('keeps counting through renders that change nothing about the result', async () => {
    const decided = decidedAgo(0);
    const mounted = setUp(phone(), { pad: decided });
    await wait(4_000);
    await show(mounted, { ...decided, line: null });
    expect(left(mounted)).toBe(41);
  });

  it('hands a pad that is not a result back as it is', async () => {
    const mounted = setUp(phone());
    expect(mounted.result.current).toBe(PLAYING);
    const covered = padWith({ kind: 'viewOnly' });
    await show(mounted, covered);
    expect(mounted.result.current).toBe(covered);
  });

  it('is nothing while there is no pad', async () => {
    const mounted = setUp(phone());
    await show(mounted, null);
    expect(mounted.result.current).toBeNull();
  });
});

describe('a result that is not this phone’s own tap', () => {
  it('opens no window for a result with no start: the card is closed and Undo off', async () => {
    const mounted = setUp(phone(), { pad: DECIDED_BY_OTHER });
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
    await wait(10_000);
    expect(left(mounted)).toBeNull();
    expect(timers()).toBe(0);
  });

  // Undo is off on the pad whenever another scorer's tap stands after this phone's: a start cannot offer it.
  it('opens none for a start whose result is the other scorer’s on top: Undo is off on the pad', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(0, NOT_OWN) });
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
  });
});

describe('the timer', () => {
  // It runs only while the window is open, as ONE timer for the next change of the card, and nothing is left running
  // when the window is closed, the match reopened or the screen gone.
  it('is one timer while the window is open, none otherwise', async () => {
    const mounted = setUp(phone());
    expect(timers()).toBe(0);
    await show(mounted, DECIDED_BY_OTHER);
    expect(timers()).toBe(0);
    await show(mounted, PLAYING);
    expect(timers()).toBe(0);
    await show(mounted, decidedAgo(0));
    expect(timers()).toBe(1);
    await wait(15_000);
    expect(timers()).toBe(1);
    await wait(15_000);
    expect(timers()).toBe(1);
    await wait(15_000);
    expect(left(mounted)).toBeNull();
    expect(timers()).toBe(0);
  });

  // Another scorer's tap takes Undo off the result and the timer stops; when their tap is taken back, Undo returns with
  // the seconds the window really has left, not the count where it stopped.
  it('counts what is really left when Undo comes back after the timer stopped', async () => {
    const start = Date.now();
    const own = { ...padWith(RESULT, OWN), decidedAt: start };
    const mounted = setUp(phone(), { pad: own });
    await wait(5_000);
    expect(left(mounted)).toBe(40);
    await show(mounted, { ...padWith(RESULT, NOT_OWN), decidedAt: start });
    await wait(10_000);
    await show(mounted, own);
    expect(left(mounted)).toBe(30);
    expect(undoOf(mounted)).toBe(true);
  });

  it('is stopped when Undo reopens the match', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(0) });
    expect(timers()).toBe(1);
    await show(mounted, PLAYING);
    expect(timers()).toBe(0);
  });

  it('is cleared when the screen goes', async () => {
    const mounted = setUp(phone(), { pad: decidedAgo(0) });
    expect(timers()).toBe(1);
    mounted.unmount();
    expect(timers()).toBe(0);
  });

  it('is one timer under StrictMode’s second pass too', async () => {
    const mounted = setUp(phone(), { strict: true, pad: decidedAgo(0) });
    expect(left(mounted)).toBe(45);
    await wait(2_000);
    expect(left(mounted)).toBe(43);
    expect(timers()).toBe(1);
  });

  // A timer can fire a hair before the phone's clock reads the change (the clock was set back after the timer was set, as a
  // network time sync does): the render shows the same second and sets the rest, and the digit changes when the clock does.
  it('fires early when the clock was set back after the timer was set: the same second shows, a second timer finishes the change', async () => {
    let setBack = 0;
    const adjusted = createFakePorts({ clock: () => new Date(Date.now() - setBack) }).ports;
    baseline = vi.getTimerCount();
    const mounted = setUp(adjusted, { pad: decidedAgo(400) });
    expect(left(mounted)).toBe(45);
    setBack = 3;
    await wait(600);
    expect(left(mounted)).toBe(45);
    expect(timers()).toBe(1);
    await wait(3);
    expect(left(mounted)).toBe(44);
    expect(timers()).toBe(1);
  });

  it('is stopped when another scorer’s event takes Undo away from the result under it', async () => {
    const start = Date.now();
    const mounted = setUp(phone(), { pad: { ...padWith(RESULT, OWN), decidedAt: start } });
    await show(mounted, { ...padWith(RESULT, NOT_OWN), decidedAt: start });
    expect(left(mounted)).toBeNull();
    expect(timers()).toBe(0);
  });
});
