import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBadmintonMatch } from '@/hooks/useBadmintonMatch';
import { LanguageProvider } from '@/hooks/useLanguage';
import { PortsProvider, type Ports } from '@/hooks/usePorts';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { createSteadyClock } from '@/services/steadyClock';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, timerClock, type FakePorts } from '../../test/fakePorts';

// Owner, 2026-11-03: Undo closes 45 s after a match is decided by this phone's own tap. The window's rule and timer are
// `undoWindow.test.ts` and `useUndoWindow.test.tsx`; here the match hook hands the pad over with it applied, over the
// real runner, hub, queue store and reducer, and the fake server. A restart is a new `Ports` over the same files and
// the same server: the launch's memory goes, the phone's disk stays.

const FIXTURE = SINGLES_SEED.fixtureId;
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function mount(fakes: FakePorts, ports: Ports = fakes.ports) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PortsProvider ports={ports}>
        <LanguageProvider>{children}</LanguageProvider>
      </PortsProvider>
    );
  }
  return renderHook(() => useBadmintonMatch(FIXTURE), { wrapper: Wrapper });
}
type Match = ReturnType<typeof mount>;
type Pad = Extract<ReturnType<typeof useBadmintonMatch>, { kind: 'pad' }>;
function pad(match: Match): Pad {
  const now = match.result.current;
  if (now.kind !== 'pad') throw new Error(`expected the pad, got ${now.kind}`);
  return now;
}
/** The result card's Undo window as the pad says it: the seconds left, null when closed, 'no card' off a result. */
function undoLeft(match: Match): number | null | 'no card' {
  const { card } = pad(match).view;
  return card?.kind === 'resultRecorded' ? card.undoLeft : 'no card';
}
const undoOn = (match: Match) => pad(match).view.lastTap?.undo;

async function rig(): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, 'stg.seazn.club', 'badminton');
  return fakes;
}

/** The match started by this phone, 41 rallies from another scorer, then this phone's 42nd: the decider. */
async function decidedByThisPhone(fakes: FakePorts): Promise<Match> {
  const match = mount(fakes);
  await flush();
  act(() => pad(match).actions.pickServer('first'));
  act(() => pad(match).actions.start());
  await flush();
  await wait(1_000);
  for (let i = 0; i < 41; i += 1) {
    fakes.scoring.addOtherScorerEvent('badminton.rally', {
      wonBy: SINGLES_SEED.sides.home.entrantId,
    });
  }
  fakes.realtime.ping();
  await flush();
  await wait(1_000);
  act(() => pad(match).actions.tapHalf('first'));
  await flush();
  await wait(1_000);
  return match;
}

/**
 * A phone whose wall clock the test moves alone (`jump`), with the steady clock `createNativePorts` builds over it: the
 * clock every scoring time on the phone is read on (rulings 137, 149).
 */
async function jumpingRig(): Promise<{
  fakes: FakePorts;
  jump: (ms: number) => void;
  sleep: (ms: number) => void;
}> {
  let skew = 0;
  let asleep = 0;
  const wall = () => Date.now() + skew;
  const fakes = createFakePorts({ clock: () => new Date(wall()) });
  const steadyClock = createSteadyClock({
    wall,
    mono: () => Date.now() - asleep,
    logger: fakes.ports.logger,
    foreground: fakes.foreground,
    serverClock: fakes.serverClock,
  });
  Object.assign(fakes.ports, { steadyClock });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, 'stg.seazn.club', 'badminton');
  return {
    fakes,
    jump: (ms) => (skew += ms),
    // Real time and the wall clock run on; the monotonic source stops (CLOCK_MONOTONIC in suspend).
    sleep: (ms) => {
      asleep += ms;
      vi.setSystemTime(Date.now() + ms);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T09:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('the pad of a match this phone decided', () => {
  // A restart: the phone's disk and the server still hold the match, whose last own event decided it. Nothing of the
  // launch's memory is left, so the window is not there: the match shows no Undo at all, however soon it reopens. The
  // rest of the window (counting, closing, Undo, Home and back, the other scorer) is the routed screen test's, over the
  // same runner, and the hub's own test holds where its start is kept.
  it('after a restart shows the decided match with no Undo at all', async () => {
    const fakes = await rig();
    const first = await decidedByThisPhone(fakes);
    expect(undoLeft(first)).toBe(44);
    expect(undoOn(first)).toBe(true);
    first.unmount();
    await flush();
    const restarted = mount(fakes, { ...fakes.ports });
    await flush();
    expect(undoLeft(restarted)).toBeNull();
    expect(undoOn(restarted)).toBe(false);
    await wait(10_000);
    expect(undoLeft(restarted)).toBeNull();
  });

  // Ruling 149's audit: the window is a span of this phone's own time, its start and every reading of it on the steady
  // clock, so a wall clock moved while it counts neither closes it early nor keeps it open past 45 s.
  it.each([
    ['+4:05', 245_000],
    ['−4:05', -245_000],
  ])(
    'the wall clock moved %s while the window counts: it still counts real seconds',
    async (_, ms) => {
      const { fakes, jump } = await jumpingRig();
      const match = await decidedByThisPhone(fakes);
      expect(undoLeft(match)).toBe(44);
      jump(ms);
      await wait(10_000);
      expect(undoLeft(match)).toBe(34);
      expect(undoOn(match)).toBe(true);
      await wait(34_000);
      expect(undoLeft(match)).toBeNull();
      expect(undoOn(match)).toBe(false);
    },
  );

  // The reducer judges a press of Undo on the runner's clock (`undoRunOut`), the same steady clock the card reads.
  it('the wall clock moved +4:05 while the window counts: Undo 10 s after the decision is still taken', async () => {
    const { fakes, jump } = await jumpingRig();
    const match = await decidedByThisPhone(fakes);
    jump(245_000);
    await wait(10_000);
    act(() => void pad(match).actions.undo());
    await flush();
    expect(undoLeft(match)).toBe('no card');
  });

  it('the wall clock moved −4:05 while the window counts: Undo 46 s after the decision is refused', async () => {
    const { fakes, jump } = await jumpingRig();
    const match = await decidedByThisPhone(fakes);
    jump(-245_000);
    await wait(45_000);
    act(() => void pad(match).actions.undo());
    await flush();
    expect(undoLeft(match)).toBeNull();
  });

  // Review M3: through the real steady clock's rebase at a return. Asleep a minute, the window comes back closed.
  it('the phone asleep a minute while the window counts: back in front it is closed, and Undo is refused', async () => {
    const { fakes, sleep } = await jumpingRig();
    const match = await decidedByThisPhone(fakes);
    expect(undoLeft(match)).toBe(44);
    fakes.foreground.leave();
    sleep(60_000);
    act(() => fakes.foreground.fire());
    await flush();
    expect(undoLeft(match)).toBeNull();
    act(() => void pad(match).actions.undo());
    await flush();
    expect(undoLeft(match)).toBeNull();
  });
});
