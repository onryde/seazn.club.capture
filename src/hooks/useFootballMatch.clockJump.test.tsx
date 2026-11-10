import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFootballMatch } from '@/hooks/useFootballMatch';
import { footballSeed } from '@/services/fakeFootballPad';
import {
  createFakeScoringPort,
  type FakeMatchSeed,
  type FakeScoringPort,
  type FakeSeedEvent,
} from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { createServerClock, type ServerClock } from '@/services/serverClock';
import { createSteadyClock, type SteadyClock } from '@/services/steadyClock';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// Device finding F5 (build 1035, staging), controller ruling 137: with the pad open and the offset formed, the phone's
// wall clock was set 4:58 ahead by hand, and the pad's clock and a Goal's minute moved 4:58 with it until fresh answers
// came. Here the server (and real time) is vitest's fake `Date`; the phone's wall clock is that plus `skew`, which a test
// moves alone; the monotonic source is real time less the time the CPU slept. The offset is the real server clock's,
// formed from samples; no new sample arrives after the jump.

const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const T0 = Date.parse('2026-11-08T14:00:00.000Z');
/** The jump the device run made by hand: 4:58. */
const JUMP_MS = 298_000;

const START: FakeSeedEvent = { type: 'core.start', payload: {} };
const KICK_OFF: FakeSeedEvent = {
  type: 'football.clock',
  payload: { running: true, at: { period: 'H1', elapsed: 0 } },
};
/** Started on the console and the clock running from 0:00 at T0. */
const LIVE = footballSeed({ events: [START, KICK_OFF] });
/** Started, the clock not yet. */
const STARTED = footballSeed({ events: [START] });

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

const wait = (ms = 1_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

type Phone = {
  readonly fakes: FakePorts;
  readonly server: FakeScoringPort;
  readonly serverClock: ServerClock;
  /** The phone's wall clock moves alone. */
  readonly jump: (ms: number) => void;
  /** The CPU sleeps for `ms`: real time and the wall clock run on, the monotonic source does not, no timer fires. */
  readonly sleep: (ms: number) => void;
};

/** A phone whose wall clock is `skew` off the server's at launch, its offset formed from `samples` of it. */
async function phone(seed: FakeMatchSeed, skew = 0): Promise<Phone> {
  let wallSkew = skew;
  let asleep = 0;
  const wall = () => Date.now() + wallSkew;
  const server = createFakeScoringPort(seed, { stamp: () => Date.now() });
  let steady: SteadyClock | null = null;
  const fakes = createFakePorts({
    clock: () => new Date(wall()),
    scoring: server,
    steadyClock: { nowMs: () => steady!.nowMs() },
  });
  steady = createSteadyClock({
    wall,
    mono: () => Date.now() - asleep,
    logger: fakes.ports.logger,
    foreground: fakes.foreground,
  });
  const serverClock = createServerClock({ logger: fakes.ports.logger });
  // The ports are built before the server clock: it is handed in as the ports hold it.
  Object.assign(fakes.ports, { serverClock });
  // The samples as the scoring port measures them, server less device now: three agree.
  for (let i = 0; i < 3; i += 1) serverClock.sample(-skew);
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'football');
  return {
    fakes,
    server,
    serverClock,
    jump: (ms) => {
      wallSkew += ms;
    },
    sleep: (ms) => {
      asleep += ms;
      vi.setSystemTime(Date.now() + ms);
    },
  };
}

async function opened(seed: FakeMatchSeed = LIVE, skew = 0) {
  const rig = await phone(seed, skew);
  const view = renderHook(() => useFootballMatch(seed.fixtureId), {
    wrapper: wrapperFor(rig.fakes),
  });
  await flush();
  await wait();
  return { ...rig, view };
}

type Match = Awaited<ReturnType<typeof opened>>['view'];
type Pad = Extract<ReturnType<typeof useFootballMatch>, { kind: 'pad' }>;

function pad(view: Match): Pad {
  const match = view.result.current;
  if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
  return match;
}

const press = (view: Match, make: (actions: Pad['actions']) => void) =>
  act(() => make(pad(view).actions));

async function ledger(server: FakeScoringPort, seed: FakeMatchSeed) {
  const events = await server.events(LINK, seed.fixtureId, 0);
  return Array.isArray(events) ? events : [];
}

const stampOf = (payload: unknown) => (payload as { at: { elapsed: number } }).at.elapsed;

/** A Goal, scorer not known: the column, then the step's choice after its bounce window. */
async function goal(view: Match) {
  press(view, (actions) => actions.column('goal.first'));
  await wait(300);
  press(view, (actions) => actions.choose('dontKnow'));
  await flush();
  await wait(300);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a wall-clock jump never moves the match clock (F5, ruling 137)', () => {
  it.each([
    ['+4:58', JUMP_MS],
    ['−4:58', -JUMP_MS],
  ])(
    'a jump of %s with the pad open: the reading and a Goal’s stamp stay on match time',
    async (_, ms) => {
      const { view, server, jump } = await opened();
      await wait(29_000);
      expect(pad(view).readingNow()).toBe(30);
      jump(ms);
      expect(pad(view).readingNow()).toBe(30);
      await goal(view);
      const scored = (await ledger(server, LIVE)).at(-1);
      expect(scored?.type).toBe('football.goal');
      expect(stampOf(scored?.payload)).toBe(30);
      await wait(10_000);
      expect(pad(view).readingNow()).toBe(40);
    },
  );

  it('the jump is in the record once, as scoring.clock.jump {ms}', async () => {
    const { view, fakes, jump } = await opened();
    await wait(29_000);
    jump(JUMP_MS);
    pad(view).readingNow();
    await wait(5_000);
    pad(view).readingNow();
    const said = readRecord(fakes.record).filter((line) => line.event === 'scoring.clock.jump');
    expect(said.map((line) => line.fields)).toEqual([{ ms: JUMP_MS }]);
  });

  it('a phone 5 minutes slow from launch reads the server’s time once the samples have come', async () => {
    const { view } = await opened(LIVE, -300_000);
    await wait(29_000);
    expect(pad(view).readingNow()).toBe(30);
  });

  it('with no sample yet, a phone 5 minutes slow reads its own time (the offset is what corrects it)', async () => {
    const rig = await phone(LIVE, -300_000);
    Object.assign(rig.fakes.ports, {
      serverClock: createServerClock({ logger: rig.fakes.ports.logger }),
    });
    const view = renderHook(() => useFootballMatch(LIVE.fixtureId), {
      wrapper: wrapperFor(rig.fakes),
    });
    await flush();
    await wait(30_000);
    expect(pad(view).readingNow()).toBe(0);
  });

  // The tap's own time (its queue entry's `createdAt`) is the anchor of a queued Start: stamped on the wall clock after
  // a jump, it would sit 4:58 off the clock the reading runs on.
  it.each([
    ['+4:58', JUMP_MS],
    ['−4:58', -JUMP_MS],
  ])('a jump of %s, then a Start queued offline: it runs from its tap', async (_, ms) => {
    const { view, server, jump } = await opened(STARTED);
    jump(ms);
    server.goOffline(true);
    press(view, (actions) => actions.clock());
    await flush();
    await wait(20_000);
    expect(pad(view).readingNow()).toBe(20);
  });

  it('a Start queued offline, then a jump: the reading and the resync after it count real seconds', async () => {
    const { view, server, fakes, jump } = await opened(STARTED);
    server.goOffline(true);
    press(view, (actions) => actions.clock());
    await flush();
    await wait(20_000);
    jump(JUMP_MS);
    expect(pad(view).readingNow()).toBe(20);
    server.goOffline(false);
    fakes.realtime.ping();
    await flush();
    const tapped = Date.now();
    await wait(20_000);
    await flush();
    const stamps = (await ledger(server, STARTED))
      .filter((event) => event.type === 'football.clock')
      .map((event) => stampOf(event.payload));
    // The Start at 0, then one resync by the wait until it was accepted: never the wall clock's 4:58 more.
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBe(0);
    expect(stamps[1]).toBeGreaterThanOrEqual(20);
    expect(stamps[1]).toBeLessThanOrEqual(20 + Math.ceil((Date.now() - tapped) / 1000));
  });

  it('the app away while the wall clock is set back: the return does not follow it', async () => {
    const { view, fakes, jump } = await opened();
    await wait(29_000);
    fakes.foreground.leave();
    jump(-JUMP_MS);
    await wait(5_000);
    act(() => fakes.foreground.fire());
    expect(pad(view).readingNow()).toBe(35);
  });

  it('the app away while the phone sleeps: the return catches up the time slept', async () => {
    const { view, fakes, sleep } = await opened();
    await wait(29_000);
    fakes.foreground.leave();
    sleep(600_000);
    act(() => fakes.foreground.fire());
    expect(pad(view).readingNow()).toBe(630);
  });
});
