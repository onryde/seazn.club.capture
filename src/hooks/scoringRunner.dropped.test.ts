import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { createScoringRunner, type ScoringRunner } from '@/hooks/scoringRunner';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// A tap the phone's own check drops (the ledger made it illegal while the phone was away) leaves the queue without
// counting. The pad says it once on the last-tap line; the record must say it too, with how many (spec section 6.3
// residual: "a refusal line in the record, never silent"; review of the whole branch, 2026-11-03). The line is
// `scoring.dropped {reason, count}`: `reason` and not `code`, since the scrub masks any field named `code`.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const HOME = SINGLES_SEED.sides.home.entrantId;
const HOME_PLAYER = `${HOME}-p1`;
const START: BadmintonTap = { kind: 'start', server: 'first' };
const FIRST: BadmintonTap = { kind: 'rally', side: 'first' };
const SECOND: BadmintonTap = { kind: 'rally', side: 'second' };

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

const tap = (made: BadmintonTap, key: string): MatchEvent => ({
  kind: 'tap',
  tap: made,
  key,
  at: new Date(Date.now()).toISOString(),
});

async function open(fakes: FakePorts): Promise<ScoringRunner> {
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'focused' });
  await runner.start();
  await flush();
  return runner;
}

const stateOf = (runner: ScoringRunner) => {
  const snapshot = runner.snapshot();
  if (snapshot.kind !== 'ready') throw new Error(`not ready: ${snapshot.kind}`);
  return snapshot.state;
};

const lines = (fakes: FakePorts, event: string) =>
  readRecord(fakes.record).filter((line) => line.event === event);

/** The match is on and the phone has scored a rally the server holds; then the signal goes. */
async function scoredThenOffline(fakes: FakePorts): Promise<ScoringRunner> {
  const runner = await open(fakes);
  runner.dispatch(tap(START, 'k-start'));
  await flush();
  runner.dispatch(tap(FIRST, 'k-r1'));
  await wait(2);
  fakes.scoring.goOffline(true);
  return runner;
}

/** Another scorer disqualifies the home side's player: no rally is legal after it. */
const disqualified = (fakes: FakePorts): void => {
  fakes.scoring.addOtherScorerEvent('badminton.sanction', {
    by: HOME,
    level: 'disqualification',
    person: HOME_PLAYER,
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the record says a tap the phone dropped', () => {
  it('two rallies queued offline, a disqualification elsewhere: both dropped, ONE line with the count', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await scoredThenOffline(fakes);
    runner.dispatch(tap(FIRST, 'k-r2'));
    runner.dispatch(tap(SECOND, 'k-r3'));
    await wait(2);
    expect(stateOf(runner).sync.queue.pending.map((queued) => queued.key)).toEqual([
      'k-r2',
      'k-r3',
    ]);
    expect(lines(fakes, 'scoring.dropped')).toEqual([]);

    disqualified(fakes);
    fakes.scoring.goOffline(false);
    await wait(30);

    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    const said = lines(fakes, 'scoring.dropped');
    expect(said).toHaveLength(1);
    expect(said[0].level).toBe('warn');
    expect(said[0].fields).toEqual({ reason: 'NO_LONGER_LEGAL', count: 2 });
    await runner.stop();
  });

  it('one dropped tap is count 1', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await scoredThenOffline(fakes);
    runner.dispatch(tap(FIRST, 'k-r2'));
    await wait(2);

    disqualified(fakes);
    fakes.scoring.goOffline(false);
    await wait(30);

    const said = lines(fakes, 'scoring.dropped');
    expect(said).toHaveLength(1);
    expect(said[0].fields).toEqual({ reason: 'NO_LONGER_LEGAL', count: 1 });
    await runner.stop();
  });

  it('the screen keeps its one line for two dropped taps, and the record line names no tap, id or payload', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await scoredThenOffline(fakes);
    runner.dispatch(tap(FIRST, 'k-r2'));
    runner.dispatch(tap(SECOND, 'k-r3'));
    await wait(2);
    disqualified(fakes);
    fakes.scoring.goOffline(false);
    await wait(30);

    expect(stateOf(runner).line).toEqual({ kind: 'refusal', key: 'scoring.refusal.notCounted' });
    const [said] = lines(fakes, 'scoring.dropped');
    expect(Object.keys(said.fields).sort()).toEqual(['count', 'reason']);
    const written = JSON.stringify(said);
    for (const secret of ['k-r2', 'k-r3', HOME_PLAYER, FAKE_SCORING_SECRET, 'seazn.club']) {
      expect(written).not.toContain(secret);
    }
    await runner.stop();
  });

  it('writes none while nothing is dropped: taps answered, and a reconnect that finds the queue legal', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await scoredThenOffline(fakes);
    runner.dispatch(tap(FIRST, 'k-r2'));
    await wait(2);
    fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME });
    fakes.scoring.goOffline(false);
    await wait(30);

    expect(lines(fakes, 'scoring.dropped')).toEqual([]);
    await runner.stop();
  });

  it('a tap refused at the pad itself is no queue drop: no line, and the earlier line stands alone', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await scoredThenOffline(fakes);
    runner.dispatch(tap(FIRST, 'k-r2'));
    await wait(2);
    disqualified(fakes);
    fakes.scoring.goOffline(false);
    await wait(30);
    expect(lines(fakes, 'scoring.dropped')).toHaveLength(1);

    // The disqualification stands, so the pad refuses the next rally before it is queued.
    runner.dispatch(tap(SECOND, 'k-r4'));
    await wait(5);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    expect(lines(fakes, 'scoring.dropped')).toHaveLength(1);
    await runner.stop();
  });

  it.each([
    ['the server’s own word', 'RALLY_NOT_ALLOWED', 'RALLY_NOT_ALLOWED'],
    ['free text, which might hold a secret, as OTHER', 'bad token=abc https://x.y/?k=1', 'OTHER'],
  ])('the server refusing a tap is the same line, with %s', async (_name, code, said) => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await open(fakes);
    runner.dispatch(tap(START, 'k-start'));
    await flush();
    vi.spyOn(fakes.scoring, 'append').mockResolvedValue({ kind: 'refused', status: 422, code });
    runner.dispatch(tap(FIRST, 'k-r1'));
    await wait(5);

    expect(stateOf(runner).sync.queue.pending.map((queued) => queued.key)).not.toContain('k-r1');
    const lineOf = lines(fakes, 'scoring.dropped');
    expect(lineOf).toHaveLength(1);
    expect(lineOf[0].fields).toEqual({ reason: said, count: 1 });
    await runner.stop();
  });
});
