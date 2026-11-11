import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapToWire, type AppendBody, type LedgerEvent } from '@/domain/scoring/wire';
import { scoringPortFor } from '@/hooks/scoringPortWiring';
import { useFootballMatch } from '@/hooks/useFootballMatch';
import { footballSeed } from '@/services/fakeFootballPad';
import {
  createFakeScoringPort,
  type FakeMatchSeed,
  type FakeScoringPort,
  type FakeSeedEvent,
} from '@/services/fakeScoringPort';
import type { ScoringFetch } from '@/services/fetchScoringPort';
import type { FetchResponse } from '@/services/httpAsk';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { createServerClock, type ServerClock } from '@/services/serverClock';
import { createSteadyClock } from '@/services/steadyClock';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, type FakePorts } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

// Device run 1, "Stage 3: time change on C" (build 1039 = bca29fe6): fixture C's clock STARTED BY THIS PHONE, the pad
// open and in step with the console; the owner set the wall clock about +4:05 in Android Settings and came back; the
// phone then read 4:03–4:05 ahead at +5, +10, +30 and +60 s, a Goal and a Pause did not correct it, and the Pause wrote
// the skew into the ledger.
//
// Everything the production wiring builds is real here: `createSteadyClock` (its rebase and `dropSamples` at a return),
// `createServerClock`, and the scoring port from `scoringPortFor` over a fetch whose every answer carries a correct
// `Date` header (vitest's fake `Date` is the server's time). Only the HTTP server behind the fetch is the fake one.
// The phone's wall clock is that time plus `skew`, which the test moves alone; the monotonic source is real time.

const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const T0 = Date.parse('2026-11-11T09:27:30.000Z');
/** The device run's hand-set jump: about +4:05. */
const JUMP_MS = 245_000;

const START: FakeSeedEvent = { type: 'core.start', payload: {} };
const KICK_OFF: FakeSeedEvent = {
  type: 'football.clock',
  payload: { running: true, at: { period: 'H1', elapsed: 0 } },
};
/** Started, the clock not yet: the phone starts it (fixture C, stage 3 item 1). */
const STARTED = footballSeed({ events: [START] });
/** The clock started on the console, at 0:00 when the server is built. */
const LIVE = footballSeed({ events: [START, KICK_OFF] });

/** The server's whole second, as an HTTP `Date` header names it (the fake timers sit on whole seconds here, so a
 * sample is the jump less the header's half second: `offsetSampleOf`). */
const dateHeader = () => new Date(Math.floor(Date.now() / 1000) * 1000).toUTCString();

const answer = (status: number, body: unknown): FetchResponse => ({
  status,
  headers: { get: (name) => (name === 'Date' ? dateHeader() : null) },
  text: async () => JSON.stringify(body),
});

const ok = (data: unknown) => ({ ok: true, data, requestId: 'req' });
const OFFLINE = () => answer(503, { ok: false, error: { code: 'UNAVAILABLE' }, requestId: 'req' });

const eventToWire = (event: LedgerEvent) => ({
  id: event.id,
  seq: event.seq,
  type: event.type,
  payload: event.payload,
  recorded_at: event.recordedAt,
  recorded_by: null,
  voids_event_id: event.voids,
  device_link_id: event.deviceLinkId,
});

/**
 * The web's capture API over the fake server, in its own wire shapes, every answer with a `Date` header. While `down()`
 * the request fails as a dead cell's does: no answer, so no sample.
 */
function httpOver(server: FakeScoringPort, down: () => boolean): ScoringFetch {
  return async (url, init) => {
    if (down()) throw new TypeError('Network request failed');
    const { pathname, searchParams } = new URL(url);
    const fixture = /\/api\/v1\/(?:public\/)?fixtures\/([^/]+)\/(.+)$/.exec(pathname);
    if (pathname === '/api/v1/device-link') {
      const boot = await server.bootstrap(LINK);
      return boot.kind === 'ok' ? answer(200, bootstrapToWire(boot.bootstrap)) : OFFLINE();
    }
    if (fixture === null) return answer(404, { ok: false, error: { code: 'NOT_FOUND' } });
    const [, id, rest] = fixture;
    const fixtureId = decodeURIComponent(id!);
    if (rest === 'events' && init.method === 'GET') {
      const events = await server.events(LINK, fixtureId, Number(searchParams.get('since_seq')));
      return Array.isArray(events) ? answer(200, ok(events.map(eventToWire))) : OFFLINE();
    }
    if (rest === 'events' && init.method === 'POST') {
      const said = await server.append(LINK, fixtureId, JSON.parse(init.body!) as AppendBody);
      if (said.kind !== 'accepted') return OFFLINE();
      return answer(
        201,
        ok({ seq: said.seq, event_id: said.eventId, rules_version: said.rulesVersion }),
      );
    }
    if (rest === 'rules') {
      const rules = await server.rules(LINK, fixtureId);
      return 'kind' in rules
        ? OFFLINE()
        : answer(
            200,
            ok({
              cfg: rules.cfg,
              rules_version: rules.rulesVersion,
              format_line: rules.formatLine,
            }),
          );
    }
    // No Realtime grant: the runner polls, as a phone does when the route has none.
    return answer(404, { ok: false, error: { code: 'NOT_FOUND' } });
  };
}

type Rig = {
  readonly fakes: FakePorts;
  readonly server: FakeScoringPort;
  readonly serverClock: ServerClock;
  readonly jump: (ms: number) => void;
  readonly offline: (on: boolean) => void;
  /** The phone asleep `ms`: real time and the wall clock run on, the monotonic source does not (CLOCK_MONOTONIC). */
  readonly sleep: (ms: number) => void;
};

type PhoneOptions = {
  /** How far the phone's wall clock is off the server's when the app starts. */
  readonly skew?: number;
  /** A cold start: the server and the queue's files the app before it left behind. */
  readonly after?: Rig;
  /** No network from the start. */
  readonly offline?: boolean;
};

/** The phone as `createNativePorts` builds it: one server clock, one steady clock, the real port fed by both. */
async function phone(seed: FakeMatchSeed, options: PhoneOptions = {}): Promise<Rig> {
  let wallSkew = options.skew ?? 0;
  let down = options.offline ?? false;
  let asleep = 0;
  const wall = () => Date.now() + wallSkew;
  const server = options.after?.server ?? createFakeScoringPort(seed, { stamp: () => Date.now() });
  const fakes = createFakePorts({
    clock: () => new Date(wall()),
    ...(options.after === undefined ? {} : { tapQueue: options.after.fakes.tapQueue }),
  });
  const { logger } = fakes.ports;
  const serverClock = createServerClock({ logger });
  const steadyClock = createSteadyClock({
    wall,
    mono: () => Date.now() - asleep,
    logger,
    foreground: fakes.foreground,
    serverClock,
  });
  const scoring = scoringPortFor({
    fetch: httpOver(server, () => down),
    logger,
    hosts: [HOST],
    serverClock,
    steadyClock,
  });
  Object.assign(fakes.ports, { serverClock, steadyClock, scoring });
  await saveScoringLink(fakes.kv, seed.fixtureId, LINK, HOST, 'football');
  return {
    fakes,
    server,
    serverClock,
    jump: (ms) => (wallSkew += ms),
    offline: (on) => (down = on),
    sleep: (ms) => {
      asleep += ms;
      vi.setSystemTime(Date.now() + ms);
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 400; i += 1) await Promise.resolve();
  });
}

const wait = (ms = 1_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

type Pad = Extract<ReturnType<typeof useFootballMatch>, { kind: 'pad' }>;

async function opened(seed: FakeMatchSeed, options: PhoneOptions = {}) {
  const rig = await phone(seed, options);
  const view = renderHook(() => useFootballMatch(seed.fixtureId), {
    wrapper: wrapperFor(rig.fakes),
  });
  await flush();
  await wait();
  const pad = (): Pad => {
    const match = view.result.current;
    if (match.kind !== 'pad') throw new Error(`expected the pad, got ${match.kind}`);
    return match;
  };
  return { ...rig, view, pad };
}

const stampOf = (payload: unknown) => (payload as { at: { elapsed: number } }).at.elapsed;

async function clockEvents(server: FakeScoringPort, seed: FakeMatchSeed) {
  const events = await server.events(LINK, seed.fixtureId, 0);
  return (Array.isArray(events) ? events : []).filter((event) => event.type === 'football.clock');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('F5 on build 1039: a jump made while away, through the real wiring', () => {
  // The control: the clock's anchor is the server's event, and the fix works as designed.
  it('the clock started on the console: right once the return’s answer lands', async () => {
    const { pad, fakes, serverClock, jump } = await opened(LIVE);
    await wait(29_000);
    expect(pad().readingNow()).toBe(30);
    fakes.foreground.leave();
    jump(JUMP_MS);
    await wait(5_000);
    act(() => fakes.foreground.fire());
    await flush();
    await wait(5_000);
    expect(serverClock.offsetMs()).toBe(-JUMP_MS + 500);
    expect(pad().readingNow()).toBe(40);
  });

  // The device run: the clock's anchor is this phone's own Start, held as the stand-in `sync.ts` writes at the phone's
  // time (`deviceLinkId: null`), which `anchorBase` reads on the phone's clock, so the offset cancels out of it.
  it('the clock started by this phone (fixture C): the reading, a Pause’s stamp and the ledger stay on match time', async () => {
    const { pad, fakes, server, serverClock, jump } = await opened(STARTED);
    act(() => pad().actions.clock());
    await flush();
    await wait(30_000);
    expect(pad().readingNow()).toBe(30);
    // Android Settings → Date & time, the wall clock +4:05, back to the pad.
    fakes.foreground.leave();
    jump(JUMP_MS);
    await wait(5_000);
    act(() => fakes.foreground.fire());
    await flush();
    await wait(5_000);
    // The return's answer did land, and the offset followed the jump to the second.
    expect(serverClock.offsetMs()).toBe(-JUMP_MS + 500);
    // The console reads 40 here. On HEAD the pad reads 285: the jump, as the device showed.
    expect(pad().readingNow()).toBe(40);
    act(() => pad().actions.clock());
    await flush();
    await wait(1_000);
    const [, pause] = await clockEvents(server, STARTED);
    expect(pause?.payload).toMatchObject({ running: false });
    expect(stampOf(pause?.payload)).toBe(40);
  });

  // The twin: the wall clock set back while away. The return never follows a set-back, so the steady clock and the offset
  // stay where they were (the header's half second), and the reading and the Pause stay on match time.
  it('the clock started by this phone, the wall clock set back 4:05 while away: the reading and a Pause’s stamp stay on match time', async () => {
    const { pad, fakes, server, serverClock, jump } = await opened(STARTED);
    act(() => pad().actions.clock());
    await flush();
    await wait(30_000);
    fakes.foreground.leave();
    jump(-JUMP_MS);
    await wait(5_000);
    act(() => fakes.foreground.fire());
    await flush();
    await wait(5_000);
    expect(serverClock.offsetMs()).toBe(500);
    expect(pad().readingNow()).toBe(40);
    act(() => pad().actions.clock());
    await flush();
    await wait(1_000);
    const [, pause] = await clockEvents(server, STARTED);
    expect(stampOf(pause?.payload)).toBe(40);
  });

  // A jump made with the pad open: the steady clock never follows one, and nothing at all moves.
  it.each([
    ['+4:05', JUMP_MS],
    ['−4:05', -JUMP_MS],
  ])(
    'the clock started by this phone, the wall clock moved %s with the pad open: nothing moves',
    async (_, ms) => {
      const { pad, server, serverClock, jump } = await opened(STARTED);
      act(() => pad().actions.clock());
      await flush();
      await wait(30_000);
      jump(ms);
      await wait(10_000);
      expect(serverClock.offsetMs()).toBe(500);
      expect(pad().readingNow()).toBe(40);
      act(() => pad().actions.clock());
      await flush();
      await wait(1_000);
      const [, pause] = await clockEvents(server, STARTED);
      expect(stampOf(pause?.payload)).toBe(40);
    },
  );

  // The console Pauses a clock this phone started, and the phone Resumes it: the Resume's own copy is the anchor then,
  // and a jump made while away after it is corrected like any other.
  it('the console Pauses a clock this phone started, the phone Resumes it, then a jump while away: match time throughout', async () => {
    const { pad, fakes, server, jump } = await opened(STARTED);
    act(() => pad().actions.clock());
    await flush();
    await wait(30_000);
    server.addConsoleEvent('football.clock', {
      running: false,
      at: { period: 'H1', elapsed: 30 },
    });
    // The runner polls every 15 s with no Realtime grant.
    await wait(20_000);
    expect(pad().readingNow()).toBe(30);
    act(() => pad().actions.clock());
    await flush();
    await wait(10_000);
    expect(pad().readingNow()).toBe(40);
    fakes.foreground.leave();
    jump(JUMP_MS);
    await wait(5_000);
    act(() => fakes.foreground.fire());
    await flush();
    await wait(5_000);
    expect(pad().readingNow()).toBe(50);
    act(() => pad().actions.clock());
    await flush();
    await wait(1_000);
    const stamps = (await clockEvents(server, STARTED)).map((event) => [
      (event.payload as { running: boolean }).running,
      stampOf(event.payload),
    ]);
    expect(stamps).toEqual([
      [true, 0],
      [false, 30],
      [true, 30],
      [false, 50],
    ]);
  });

  // Ruling 149's other half: with no offset known yet, a tap is stamped on the phone's own clock and marked so. A cold
  // start offline (the app before it left the bootstrap on disk), on a phone 5 minutes fast: the Start is the phone's;
  // when the network comes back the offset forms at −5 minutes, and the Start, its copy and the resync after it are still
  // read on the clock they were stamped on.
  it('a cold start offline, a Start, then an offset of −5 minutes: the reading and the resync count real seconds', async () => {
    const before = await opened(STARTED);
    before.view.unmount();
    await flush();
    const { pad, server, serverClock, offline, fakes } = await opened(STARTED, {
      after: before,
      skew: 300_000,
      offline: true,
    });
    act(() => pad().actions.clock());
    await flush();
    const queued = await fakes.ports.tapQueue.load(STARTED.fixtureId);
    expect(queued?.pending).toHaveLength(1);
    expect(queued?.pending[0]).not.toHaveProperty('stampedOn');
    await wait(20_000);
    expect(pad().readingNow()).toBe(20);
    offline(false);
    // The next poll (15 s) sends the Start; its answer forms the offset.
    await wait(15_000);
    await flush();
    await wait(5_000);
    expect(serverClock.offsetMs()).toBeLessThanOrEqual(-299_000);
    expect(pad().readingNow()).toBe(40);
    const stamps = (await clockEvents(server, STARTED)).map((event) => stampOf(event.payload));
    // The Start at 0, then one resync by its wait in the queue (20 s offline, then up to the next poll): never 5 minutes.
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBe(0);
    expect(stamps[1]).toBeGreaterThanOrEqual(20);
    expect(stamps[1]).toBeLessThanOrEqual(36);
  });

  // A server stamp's wait is read on the server's clock: a phone 5 minutes fast with its offset formed, a Start queued
  // offline and sent 20 s on. Read on the phone's own clock, the wait would be 5 minutes more.
  it('a phone 5 minutes fast, a Start queued offline and accepted later: one resync by the wait, on the server’s clock', async () => {
    const { pad, server, serverClock, offline } = await opened(STARTED, { skew: 300_000 });
    expect(serverClock.freshOffsetMs()).toBeLessThanOrEqual(-299_000);
    offline(true);
    act(() => pad().actions.clock());
    await flush();
    await wait(20_000);
    expect(pad().readingNow()).toBe(20);
    offline(false);
    await wait(15_000);
    await flush();
    await wait(5_000);
    expect(pad().readingNow()).toBe(40);
    const stamps = (await clockEvents(server, STARTED)).map((event) => stampOf(event.payload));
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBe(0);
    expect(stamps[1]).toBeGreaterThanOrEqual(20);
    expect(stamps[1]).toBeLessThanOrEqual(36);
  });

  // Ruling 151 (review I1): after a return the old offset may be the jump's own error until the first fresh answer, so a
  // tap made then is stamped on the phone's rebased steady clock, unmarked, and the resync waits for a fresh offset.
  it('a jump while away, offline at the return, a Start at once, then online: the pad runs, one resync, as the console', async () => {
    const { pad, fakes, server, serverClock, jump, offline } = await opened(STARTED);
    fakes.foreground.leave();
    jump(JUMP_MS);
    offline(true);
    await wait(5_000);
    act(() => fakes.foreground.fire());
    await flush();
    act(() => pad().actions.clock());
    await flush();
    const queued = await fakes.ports.tapQueue.load(STARTED.fixtureId);
    expect(queued?.pending[0]).not.toHaveProperty('stampedOn');
    await wait(20_000);
    expect(pad().readingNow()).toBe(20);
    offline(false);
    // The next poll (15 s) sends the Start; its answer forms the fresh offset.
    await wait(15_000);
    await flush();
    await wait(5_000);
    expect(serverClock.offsetMs()).toBe(-JUMP_MS + 500);
    expect(pad().readingNow()).toBe(40);
    const stamps = (await clockEvents(server, STARTED)).map((event) => stampOf(event.payload));
    // The Start at 0, then one resync by its wait in the queue: the console reads the match time from it.
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBe(0);
    expect(stamps[1]).toBeGreaterThanOrEqual(20);
    expect(stamps[1]).toBeLessThanOrEqual(36);
  });

  // Review M1: a sleep is the rebase with no wall jump. The offset stays, and the reading catches up the time slept.
  it('the clock started by this phone, the phone asleep 10 minutes: the reading and a Pause’s stamp catch up', async () => {
    const { pad, fakes, server, serverClock, sleep } = await opened(STARTED);
    act(() => pad().actions.clock());
    await flush();
    await wait(30_000);
    fakes.foreground.leave();
    sleep(600_000);
    act(() => fakes.foreground.fire());
    await flush();
    await wait(5_000);
    expect(serverClock.offsetMs()).toBe(500);
    expect(pad().readingNow()).toBe(635);
    act(() => pad().actions.clock());
    await flush();
    await wait(1_000);
    const [, pause] = await clockEvents(server, STARTED);
    expect(stampOf(pause?.payload)).toBe(635);
  });
});
