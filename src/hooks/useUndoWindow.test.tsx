import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PadStateCard, PadView } from '@/domain/scoring/padView';
import { PortsProvider, type Ports } from '@/hooks/usePorts';
import { useUndoWindow } from '@/hooks/useUndoWindow';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import { createFakePorts, timerClock } from '../../test/fakePorts';

// Owner, 2026-11-03: Undo closes 30 s after a match is decided by this phone's own tap, with a countdown. The hook
// holds the window's start in memory, per launch (the ports) and per match; these tests drive it with pads made by
// hand, on the phone's clock moved by fake timers. The match hook and the screen are tested over it elsewhere.

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
    serving: null,
    bar: 'dim',
    hint: TEXT,
    hintLine: TEXT,
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
  };
}

const PLAYING = padWith(null);
const DECIDED = padWith({ kind: 'resultRecorded', undoLeft: null });
const DECIDED_BY_OTHER = padWith({ kind: 'resultRecorded', undoLeft: null }, NOT_OWN);

/** The hook mounted on a screen whose first pad is `pad` (a match in play unless said), as a screen opens. */
function setUp(ports: Ports, options: { strict?: boolean; pad?: Pad | null; id?: string } = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    const tree = <PortsProvider ports={ports}>{children}</PortsProvider>;
    return options.strict ? <StrictMode>{tree}</StrictMode> : tree;
  }
  return renderHook(
    (props: { id: string; pad: Pad | null }) => useUndoWindow(ports, props.id, props.pad),
    {
      wrapper: Wrapper,
      initialProps: {
        id: options.id ?? 'fixture-a',
        pad: options.pad === undefined ? PLAYING : options.pad,
      },
    },
  );
}

type Mounted = ReturnType<typeof setUp>;
const card = (mounted: Mounted) => mounted.result.current?.view.card;
const undoOf = (mounted: Mounted) => mounted.result.current?.view.lastTap?.undo;
const left = (mounted: Mounted) => {
  const shown = card(mounted);
  return shown?.kind === 'resultRecorded' ? shown.undoLeft : 'no result card';
};
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const show = (mounted: Mounted, pad: Pad | null, id = 'fixture-a') =>
  act(() => mounted.rerender({ id, pad }));

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
  it('opens at 30 the moment the decided pad is first shown, and counts down a second at a time', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    expect(left(mounted)).toBe(30);
    expect(undoOf(mounted)).toBe(true);
    await wait(1_000);
    expect(left(mounted)).toBe(29);
    await wait(14_000);
    expect(left(mounted)).toBe(15);
    await wait(14_000);
    expect(left(mounted)).toBe(1);
    expect(undoOf(mounted)).toBe(true);
  });

  it('closes at 30 s, not a tick before: 29.999 s on it is still open with 1 s left', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    await wait(29_999);
    // The tick came at 29 s; the clock now reads 29.999 s but nothing has re-read it, so the last second is on screen.
    expect(left(mounted)).toBe(1);
    await wait(1);
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
  });

  it('stays closed once closed, however long the pad stays', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    await wait(30_000);
    await wait(120_000);
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
  });

  it('reads the phone’s clock, not the count of ticks: a phone asleep for a minute comes back closed', async () => {
    const ports = phone();
    const mounted = setUp(ports);
    await show(mounted, DECIDED);
    await wait(2_000);
    expect(left(mounted)).toBe(28);
    // Timers stand still while the app sleeps; the wall clock does not.
    vi.setSystemTime(Date.now() + 60_000);
    await wait(1_000);
    expect(left(mounted)).toBeNull();
  });

  it('starts a fresh 30 s at the next decision after Undo reopened the match', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    await wait(10_000);
    expect(left(mounted)).toBe(20);
    await show(mounted, PLAYING);
    expect(card(mounted)).toBeNull();
    await wait(5_000);
    await show(mounted, DECIDED);
    expect(left(mounted)).toBe(30);
    await wait(3_000);
    expect(left(mounted)).toBe(27);
  });

  it('keeps counting through renders that change nothing about the result', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    await wait(4_000);
    await show(mounted, padWith({ kind: 'resultRecorded', undoLeft: null }));
    expect(left(mounted)).toBe(26);
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

describe('a result that is not this phone’s own tap, or not seen being made', () => {
  it('opens no window for the other scorer’s result: the card is closed and Undo off', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED_BY_OTHER);
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
    await wait(10_000);
    expect(left(mounted)).toBeNull();
  });

  it('opens no window for a result that is there when the pad is first shown (a restart)', async () => {
    const mounted = setUp(phone(), { pad: null });
    await show(mounted, DECIDED);
    expect(left(mounted)).toBeNull();
    expect(undoOf(mounted)).toBe(false);
  });
});

describe('the window outlives the screen, and not the app', () => {
  it('is the same window when the scorer goes Home and back within the 30 s', async () => {
    const ports = phone();
    const first = setUp(ports);
    await show(first, DECIDED);
    await wait(12_300);
    expect(left(first)).toBe(18);
    first.unmount();
    await wait(2_000);
    const back = setUp(ports, { pad: DECIDED });
    expect(left(back)).toBe(16);
    await wait(15_000);
    expect(left(back)).toBe(1);
    await wait(1_000);
    expect(left(back)).toBeNull();
  });

  it('does not restart when the scorer comes back after it closed', async () => {
    const ports = phone();
    const first = setUp(ports);
    await show(first, DECIDED);
    await wait(25_000);
    first.unmount();
    await wait(20_000);
    const back = setUp(ports, { pad: DECIDED });
    expect(left(back)).toBeNull();
    expect(undoOf(back)).toBe(false);
  });

  it('is gone after a restart: a new launch (new ports) shows the decided match with no Undo', async () => {
    const ports = phone();
    const first = setUp(ports);
    await show(first, DECIDED);
    await wait(5_000);
    first.unmount();
    const relaunched = setUp({ ...ports }, { pad: DECIDED });
    expect(left(relaunched)).toBeNull();
    expect(undoOf(relaunched)).toBe(false);
  });

  it('is the match’s own: another match opened on the same launch has none', async () => {
    const ports = phone();
    const first = setUp(ports);
    await show(first, DECIDED);
    first.unmount();
    const other = setUp(ports, { id: 'fixture-b', pad: DECIDED });
    expect(left(other)).toBeNull();
  });

  it('forgets a match’s window when the screen is told another match (a reused screen)', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    await wait(3_000);
    expect(left(mounted)).toBe(27);
    await show(mounted, DECIDED, 'fixture-b');
    expect(left(mounted)).toBeNull();
    await show(mounted, DECIDED, 'fixture-a');
    expect(left(mounted)).toBe(27);
  });

  it('is the same window under StrictMode’s second pass', async () => {
    const mounted = setUp(phone(), { strict: true });
    await show(mounted, DECIDED);
    expect(left(mounted)).toBe(30);
    await wait(2_000);
    expect(left(mounted)).toBe(28);
    expect(timers()).toBe(1);
  });
});

describe('the timer', () => {
  // The brief: it ticks only while the window is open, and nothing is left running when it is closed or the screen goes.
  it('runs only while the window is open', async () => {
    const mounted = setUp(phone());
    expect(timers()).toBe(0);
    await show(mounted, DECIDED_BY_OTHER);
    expect(timers()).toBe(0);
    await show(mounted, PLAYING);
    expect(timers()).toBe(0);
    await show(mounted, DECIDED);
    expect(timers()).toBe(1);
    await wait(30_000);
    expect(left(mounted)).toBeNull();
    expect(timers()).toBe(0);
  });

  // Another scorer's tap takes Undo off the result and the timer stops; when their tap is taken back, Undo returns with
  // the seconds the window really has left, not the count where it stopped.
  it('counts what is really left when Undo comes back after the timer stopped', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    await wait(5_000);
    expect(left(mounted)).toBe(25);
    await show(mounted, DECIDED_BY_OTHER);
    await wait(10_000);
    await show(mounted, DECIDED);
    expect(left(mounted)).toBe(15);
    expect(undoOf(mounted)).toBe(true);
  });

  it('is stopped when Undo reopens the match', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    expect(timers()).toBe(1);
    await show(mounted, PLAYING);
    expect(timers()).toBe(0);
  });

  it('is cleared when the screen goes', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    expect(timers()).toBe(1);
    mounted.unmount();
    expect(timers()).toBe(0);
  });

  it('is not started again by a return to a window that has closed', async () => {
    const ports = phone();
    const first = setUp(ports);
    await show(first, DECIDED);
    await wait(31_000);
    first.unmount();
    const back = setUp(ports, { pad: DECIDED });
    expect(timers()).toBe(0);
  });

  it('is stopped when another scorer’s event takes Undo away from the result under it', async () => {
    const mounted = setUp(phone());
    await show(mounted, DECIDED);
    await show(mounted, DECIDED_BY_OTHER);
    expect(left(mounted)).toBeNull();
    expect(timers()).toBe(0);
  });
});
