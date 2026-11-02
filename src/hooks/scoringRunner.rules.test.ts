import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { stallOf } from '@/domain/scoring/scoringMatchStall';
import { createScoringRunner, type RunnerMode, type ScoringRunner } from '@/hooks/scoringRunner';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { queuedOf, rally } from '../../test/badmintonLedger';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// The 2026-11-02 device stall (owner's phone, staging, badminton): a match nobody had corrected is at rules_version 0, the
// web's column default (`V469__fixture_rules_override.sql`), and the phone guessed 1 for a match it had never read the
// rules of. The web refuses any version but its own (`append-event.ts`, `!==`), the phone's rules read said 0, and
// `onRules` only ever raised the version: every send was refused FIXTURE_RULES_CHANGED, for good, and the record held ONE
// line (the reporter counts a repeated failure and does not say it again, `fetchScoringPort.ts` `reporter`). These run
// the real reducer, the real queue store on an in-memory folder and the fake server, which refuses as the web does.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const AT = '2026-11-02T20:34:10.000Z';
const HOME = SINGLES_SEED.sides.home.entrantId;
const AWAY = SINGLES_SEED.sides.away.entrantId;
const RALLY: BadmintonTap = { kind: 'rally', side: 'first' };

const tap = (made: BadmintonTap, key: string): MatchEvent => ({
  kind: 'tap',
  tap: made,
  key,
  at: AT,
});

/** Lets every promise chain that can run without a timer run: a save, a send, its answer, the next save. */
async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

/** Seconds of the clock, with the promise chains flushed after each: the sender's waits are timers. */
async function wait(seconds: number): Promise<void> {
  for (let s = 0; s < seconds; s += 1) {
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
  }
}

/** A match another scorer (a browser, the organiser's console) has been scoring: started, and 3 : 1 to the first side. */
function midMatch(fakes: FakePorts, rulesVersion: number): void {
  fakes.scoring.setRulesVersion(rulesVersion);
  fakes.scoring.addOtherScorerEvent('core.start', {});
  fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME, serving: HOME });
  fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME });
  fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: AWAY });
  fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME });
}

async function open(fakes: FakePorts, mode: RunnerMode = 'focused'): Promise<ScoringRunner> {
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode });
  await runner.start();
  await flush();
  return runner;
}

const stateOf = (runner: ScoringRunner) => {
  const snapshot = runner.snapshot();
  if (snapshot.kind !== 'ready') throw new Error(`not ready: ${snapshot.kind}`);
  return snapshot.state;
};

const sentVersions = (append: { mock: { calls: unknown[][] } }): unknown[] =>
  append.mock.calls.map((call) => (call[2] as { rules_version: number }).rules_version);

const ledgerTypes = async (fakes: FakePorts): Promise<string[]> => {
  const events = await fakes.scoring.events(LINK, FIXTURE, 0);
  return Array.isArray(events) ? events.map((event) => event.type) : [];
};

const events = (fakes: FakePorts): string[] => readRecord(fakes.record).map((line) => line.event);

const OTHERS = [
  'core.start',
  'badminton.rally',
  'badminton.rally',
  'badminton.rally',
  'badminton.rally',
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T20:34:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a match the organiser never corrected (rules_version 0, the web’s default)', () => {
  it('mid-match, first open: the phone’s taps go under version 0 and are accepted, never refused', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const append = vi.spyOn(fakes.scoring, 'append');
    const runner = await open(fakes);
    runner.dispatch(tap(RALLY, 'k1'));
    runner.dispatch(tap(RALLY, 'k2'));
    await wait(5);
    expect(sentVersions(append)).toEqual([0, 0]);
    expect(await ledgerTypes(fakes)).toEqual([...OTHERS, 'badminton.rally', 'badminton.rally']);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    expect(stateOf(runner).sync.rulesVersion).toBe(0);
  });

  // The owner's sequence (2026-11-02): the phone's Start and rallies were made against a ledger that was behind, the
  // match having been started and scored elsewhere. The server refuses the version first, then the seq.
  it('Start and a rally made on a ledger that was behind: the Start is dropped as no longer legal, the rally goes', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    fakes.scoring.setRulesVersion(0);
    const append = vi.spyOn(fakes.scoring, 'append');
    const runner = await open(fakes);
    fakes.scoring.goOffline(true);
    runner.dispatch(tap({ kind: 'start', server: 'first' }, 'k1'));
    runner.dispatch(tap(RALLY, 'k2'));
    await wait(2);
    fakes.scoring.goOffline(false);
    fakes.scoring.addOtherScorerEvent('core.start', {});
    fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME, serving: HOME });
    fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: AWAY });
    await wait(60);
    expect(await ledgerTypes(fakes)).toEqual([
      'core.start',
      'badminton.rally',
      'badminton.rally',
      'badminton.rally',
    ]);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    expect(new Set(sentVersions(append))).toEqual(new Set([0]));
  });

  it('opened again after the app was closed (the boot cache holds the web’s 0): still accepted', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const first = await open(fakes);
    first.dispatch(tap(RALLY, 'k1'));
    await wait(3);
    await first.stop();
    const append = vi.spyOn(fakes.scoring, 'append');
    const again = await open(fakes);
    again.dispatch(tap(RALLY, 'k2'));
    await wait(3);
    expect(sentVersions(append)).toEqual([0]);
    expect(await ledgerTypes(fakes)).toHaveLength(OTHERS.length + 2);
  });

  it('a version above 1 is sent as the bootstrap names it', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 3);
    const append = vi.spyOn(fakes.scoring, 'append');
    const runner = await open(fakes);
    runner.dispatch(tap(RALLY, 'k1'));
    await wait(3);
    expect(sentVersions(append)).toEqual([3]);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
  });

  it('the organiser corrects the format while the pad is open (0 to 2): one refusal, the rules are read, the tap goes', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const append = vi.spyOn(fakes.scoring, 'append');
    const runner = await open(fakes);
    fakes.scoring.setRulesVersion(2);
    runner.dispatch(tap(RALLY, 'k1'));
    await wait(5);
    expect(sentVersions(append)).toEqual([0, 2]);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
  });

  // The queue the broken build left on the owner's phone: taps stamped under the guessed 1, no boot cache for a
  // background sender (`heldOf`). The server's word, named twice, brings the phone down to 0.
  it.each<RunnerMode>(['focused', 'headless'])(
    'a queue stamped under the guessed version 1 (%s sender) recovers: one refusal, the server’s 0 is taken, the taps go',
    async (mode) => {
      const fakes = createFakePorts({ clock: timerClock });
      midMatch(fakes, 0);
      await fakes.tapQueue.save({
        fixtureId: FIXTURE,
        label: '',
        pending: [
          { ...queuedOf('k1', rally('H')), payload: { wonBy: HOME } },
          { ...queuedOf('k2', rally('H')), payload: { wonBy: HOME } },
        ],
        ownEventIds: [],
        dead: null,
      });
      const append = vi.spyOn(fakes.scoring, 'append');
      const runner = await open(fakes, mode);
      await wait(40);
      expect(sentVersions(append)).toEqual([1, 0, 0]);
      expect(await ledgerTypes(fakes)).toEqual([...OTHERS, 'badminton.rally', 'badminton.rally']);
      expect(stateOf(runner).sync.queue.pending).toEqual([]);
    },
  );
});

describe('a server that answers every send and never takes the tap', () => {
  /** The server names a version (7) no rules read ever confirms (it reads 3): the phone cannot come to agree with it. */
  function lyingServer(fakes: FakePorts): void {
    vi.spyOn(fakes.scoring, 'append').mockResolvedValue({ kind: 'rulesChanged', rulesVersion: 7 });
    const real = fakes.scoring.rules.bind(fakes.scoring);
    vi.spyOn(fakes.scoring, 'rules').mockImplementation(async (link, fixtureId) => {
      const read = await real(link, fixtureId);
      return 'cfg' in read ? { ...read, rulesVersion: 3 } : read;
    });
  }

  it('is said once in the record, with what the phone holds, and the pad’s state reads it', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const runner = await open(fakes);
    lyingServer(fakes);
    runner.dispatch(tap(RALLY, 'k1'));
    await wait(5);
    expect(events(fakes)).not.toContain('scoring.stalled');
    expect(stallOf(stateOf(runner))).toBeNull();
    await wait(120);
    expect(events(fakes).filter((event) => event === 'scoring.stalled')).toHaveLength(1);
    const line = readRecord(fakes.record).find((entry) => entry.event === 'scoring.stalled');
    expect(line?.level).toBe('warn');
    expect(line?.fields).toMatchObject({ reason: 'rules', held: 3, said: 7, count: 6 });
    expect(stallOf(stateOf(runner))).toMatchObject({ kind: 'refused', by: 'rules' });
  });

  it('is said to be over once a tap is accepted, once', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const runner = await open(fakes);
    lyingServer(fakes);
    runner.dispatch(tap(RALLY, 'k1'));
    await wait(60);
    expect(events(fakes)).toContain('scoring.stalled');
    vi.restoreAllMocks();
    await wait(60);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    expect(stallOf(stateOf(runner))).toBeNull();
    expect(events(fakes).filter((event) => event === 'scoring.unstalled')).toHaveLength(1);
    expect(events(fakes).filter((event) => event === 'scoring.stalled')).toHaveLength(1);
  });

  // Review minor, 2026-11-02: the app in the background sends nothing, so `stallOf` reads null there. That is not the stall
  // ending: a phone that goes to the background and comes back stalled has one stall, said once, not an "over" and a
  // fresh one on its return.
  it('is one stall across the background: not unsaid on leaving, not said again on returning', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const runner = await open(fakes);
    lyingServer(fakes);
    runner.dispatch(tap(RALLY, 'k1'));
    await wait(120);
    expect(events(fakes).filter((event) => event === 'scoring.stalled')).toHaveLength(1);
    fakes.foreground.leave();
    await flush();
    await wait(30);
    fakes.foreground.fire();
    await flush();
    await wait(30);
    expect(events(fakes).filter((event) => event === 'scoring.unstalled')).toHaveLength(0);
    expect(events(fakes).filter((event) => event === 'scoring.stalled')).toHaveLength(1);
    expect(stallOf(stateOf(runner))).toMatchObject({ kind: 'refused', by: 'rules' });
  });

  it('is still said over once, after the background, when the server then takes the tap', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const runner = await open(fakes);
    lyingServer(fakes);
    runner.dispatch(tap(RALLY, 'k1'));
    await wait(120);
    fakes.foreground.leave();
    await flush();
    fakes.foreground.fire();
    vi.restoreAllMocks();
    await wait(120);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    expect(events(fakes).filter((event) => event === 'scoring.unstalled')).toHaveLength(1);
    expect(events(fakes).filter((event) => event === 'scoring.stalled')).toHaveLength(1);
  });

  it('another scorer that always writes first is said as a conflict, with no rules version named', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const runner = await open(fakes);
    vi.spyOn(fakes.scoring, 'append').mockResolvedValue({ kind: 'seqConflict', currentSeq: 99 });
    runner.dispatch(tap(RALLY, 'k1'));
    await wait(120);
    const line = readRecord(fakes.record).find((entry) => entry.event === 'scoring.stalled');
    expect(line?.fields).toMatchObject({ reason: 'conflict', held: 0, said: null, count: 6 });
    expect(stallOf(stateOf(runner))).toMatchObject({ kind: 'refused', by: 'conflict' });
  });

  it('a match the engine cannot fold, with taps queued, is said as a stall at once, naming the hold that stands', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const bootstrap = fakes.scoring.bootstrap.bind(fakes.scoring);
    vi.spyOn(fakes.scoring, 'bootstrap').mockImplementation(async (link) => {
      const read = await bootstrap(link);
      return read.kind === 'ok'
        ? { kind: 'ok', bootstrap: { ...read.bootstrap, cfg: { bestOf: 'many' } } }
        : read;
    });
    await fakes.tapQueue.save({
      fixtureId: FIXTURE,
      label: '',
      pending: [{ ...queuedOf('k1', rally('H')), payload: { wonBy: HOME } }],
      ownEventIds: [],
      dead: null,
    });
    const append = vi.spyOn(fakes.scoring, 'append');
    const runner = await open(fakes);
    await wait(60);
    expect(append).not.toHaveBeenCalled();
    expect(stallOf(stateOf(runner))).toEqual({ kind: 'fold' });
    const lines = readRecord(fakes.record).filter((entry) => entry.event === 'scoring.stalled');
    expect(lines).toHaveLength(1);
    expect(lines[0].fields).toMatchObject({ reason: 'fold', state: 'revalidate', count: 0 });
  });

  it('nothing queued, no stall, nothing said', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes, 0);
    const runner = await open(fakes);
    await wait(120);
    expect(stallOf(stateOf(runner))).toBeNull();
    expect(events(fakes)).not.toContain('scoring.stalled');
  });
});
