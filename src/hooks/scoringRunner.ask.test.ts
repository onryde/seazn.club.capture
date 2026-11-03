import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import { askOf } from '@/domain/scoring/scoringMatchAsk';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { createScoringRunner, type RunnerMode, type ScoringRunner } from '@/hooks/scoringRunner';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// The reconnect question (owner ruling 43, 2026-11-02) over the real reducer, the real queue store and the fake server:
// the owner scored offline, someone scored on the web, the data came back, and the phone must ask before it sends its
// taps on top. The record says it began and how it ended (`scoring.ask {foreign, queued}`, `scoring.asked {answer}`).

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

/** A match another scorer has been scoring: started, and 2 : 1 to the first side (seq 1 to 4). */
function midMatch(fakes: FakePorts): void {
  fakes.scoring.setRulesVersion(0);
  fakes.scoring.addOtherScorerEvent('core.start', {});
  fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME, serving: HOME });
  fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME });
  fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: AWAY });
}

async function open(
  fakes: FakePorts,
  mode: RunnerMode = 'focused',
  onIdle?: () => void,
): Promise<ScoringRunner> {
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode, onIdle });
  await runner.start();
  await flush();
  return runner;
}

const stateOf = (runner: ScoringRunner) => {
  const snapshot = runner.snapshot();
  if (snapshot.kind !== 'ready') throw new Error(`not ready: ${snapshot.kind}`);
  return snapshot.state;
};

const ledgerSize = async (fakes: FakePorts): Promise<number> => {
  const events = await fakes.scoring.events(LINK, FIXTURE, 0);
  return Array.isArray(events) ? events.length : -1;
};

const lines = (fakes: FakePorts, event: string) =>
  readRecord(fakes.record).filter((line) => line.event === event);

/** The owner's evening: scored offline (two taps queued), the web scored once, the data came back, the phone read the ledger. */
async function reconnected(fakes: FakePorts): Promise<ScoringRunner> {
  midMatch(fakes);
  const runner = await open(fakes);
  fakes.scoring.goOffline(true);
  runner.dispatch(tap(RALLY, 'k1'));
  runner.dispatch(tap(RALLY, 'k2'));
  await wait(3);
  fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: AWAY });
  fakes.scoring.goOffline(false);
  runner.dispatch({ kind: 'read' });
  await flush();
  return runner;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T20:34:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the phone reconnects with taps queued and another scorer’s event in the ledger', () => {
  it('asks, said once in the record with the counts, and sends nothing however long it waits', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    await wait(120);
    expect(askOf(stateOf(runner))).toEqual({ foreign: 1, queued: 2 });
    expect(await ledgerSize(fakes)).toBe(5);
    const said = lines(fakes, 'scoring.ask');
    expect(said).toHaveLength(1);
    expect(said[0].level).toBe('info');
    expect(said[0].fields).toMatchObject({ foreign: 1, queued: 2 });
    expect(lines(fakes, 'scoring.stalled')).toHaveLength(0);
  });

  it('does not say it again when more events land, but counts them', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME });
    runner.dispatch({ kind: 'read' });
    await wait(5);
    expect(askOf(stateOf(runner))).toEqual({ foreign: 2, queued: 2 });
    expect(lines(fakes, 'scoring.ask')).toHaveLength(1);
  });

  it('Send: both taps go, in order, on top of the web’s; the record says Send once', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    runner.dispatch({ kind: 'answerAsk', answer: 'send' });
    await wait(10);
    expect(await ledgerSize(fakes)).toBe(7);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    expect(stateOf(runner).sync.queue.askedAbout).toBeUndefined();
    expect(lines(fakes, 'scoring.asked').map((line) => line.fields)).toEqual([{ answer: 'send' }]);
  });

  it('Send covers the queue as it stood: the web scoring while the taps go is not asked about again', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    runner.dispatch({ kind: 'answerAsk', answer: 'send' });
    // Another rally lands before the first tap does: the tap is turned back, fetches, and goes again on top of it.
    fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME });
    runner.dispatch({ kind: 'read' });
    for (let seconds = 0; seconds < 40; seconds += 1) {
      await wait(1);
      expect(askOf(stateOf(runner)), `${seconds}s`).toBeNull();
    }
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    expect(await ledgerSize(fakes)).toBe(8);
    expect(stateOf(runner).sync.queue.answeredSend).toBeUndefined();
    expect(lines(fakes, 'scoring.ask')).toHaveLength(1);
    expect(lines(fakes, 'scoring.asked').map((line) => line.fields)).toEqual([{ answer: 'send' }]);
  });

  it('Discard: nothing reaches the server, the queue is gone, and the record says Discard once', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    runner.dispatch({ kind: 'answerAsk', answer: 'discard' });
    await wait(10);
    expect(await ledgerSize(fakes)).toBe(5);
    expect(stateOf(runner).sync.queue.pending).toEqual([]);
    expect(lines(fakes, 'scoring.asked').map((line) => line.fields)).toEqual([
      { answer: 'discard' },
    ]);
    expect((await fakes.tapQueue.load(FIXTURE))?.pending).toEqual([]);
  });

  it('a second answer, a double tap on the button that has gone, says nothing more', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    runner.dispatch({ kind: 'answerAsk', answer: 'discard' });
    runner.dispatch({ kind: 'answerAsk', answer: 'send' });
    await wait(5);
    expect(lines(fakes, 'scoring.asked')).toHaveLength(1);
    expect(await ledgerSize(fakes)).toBe(5);
  });

  it('the phone alone offline asks nothing: its taps go by themselves when the signal is back', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes);
    const runner = await open(fakes);
    fakes.scoring.goOffline(true);
    runner.dispatch(tap(RALLY, 'k1'));
    runner.dispatch(tap(RALLY, 'k2'));
    await wait(3);
    fakes.scoring.goOffline(false);
    runner.dispatch({ kind: 'read' });
    await wait(20);
    expect(await ledgerSize(fakes)).toBe(6);
    expect(lines(fakes, 'scoring.ask')).toHaveLength(0);
    expect(askOf(stateOf(runner))).toBeNull();
  });
});

describe('a question that is not answered', () => {
  it('a link that dies while the sheet stands is no answer: the taps are kept, and the question is moot, said once', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    fakes.scoring.revoke();
    runner.dispatch({ kind: 'read' });
    await wait(5);
    expect(stateOf(runner).sync.queue.dead).not.toBeNull();
    expect(stateOf(runner).sync.queue.pending).toHaveLength(2);
    expect(askOf(stateOf(runner))).toBeNull();
    runner.dispatch({ kind: 'read' });
    await wait(60);
    expect(lines(fakes, 'scoring.asked').map((line) => line.fields)).toEqual([{ answer: 'moot' }]);
    expect(lines(fakes, 'scoring.ask')).toHaveLength(1);
  });

  /** The match's status read again, as a bootstrap read brings it: the organiser locks the result, and may open it again. */
  const readStatus = (runner: ScoringRunner, status: string, epochRequired?: number): void => {
    const { bootstrap } = stateOf(runner);
    if (bootstrap === null) throw new Error('no bootstrap held');
    runner.dispatch({
      kind: 'bootstrapRead',
      bootstrap: { ...bootstrap, status, epochRequired: epochRequired ?? bootstrap.epochRequired },
    });
  };

  it('a question the match closing hides is moot, said once however long the wait, and an answer after it is said all the same', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    readStatus(runner, 'finalized');
    await wait(60);
    expect(askOf(stateOf(runner))).toBeNull();
    expect(lines(fakes, 'scoring.asked').map((line) => line.fields)).toEqual([{ answer: 'moot' }]);
    expect(lines(fakes, 'scoring.ask')).toHaveLength(1);
    runner.dispatch({ kind: 'answerAsk', answer: 'discard' });
    await wait(3);
    expect(lines(fakes, 'scoring.asked').map((line) => line.fields)).toEqual([
      { answer: 'moot' },
      { answer: 'discard' },
    ]);
  });

  it('a question an app too old hides is not moot, and when it comes back it is not asked again', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    readStatus(runner, 'in_play', 99);
    await wait(3);
    expect(askOf(stateOf(runner))).toBeNull();
    expect(lines(fakes, 'scoring.asked')).toHaveLength(0);
    readStatus(runner, 'in_play', 2);
    await wait(3);
    expect(askOf(stateOf(runner))).toEqual({ foreign: 1, queued: 2 });
    expect(lines(fakes, 'scoring.ask')).toHaveLength(1);
    expect(lines(fakes, 'scoring.asked')).toHaveLength(0);
  });

  it('every event taken back by the web ends it as moot: said once, and the taps go on', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const runner = await reconnected(fakes);
    const web = (await fakes.scoring.events(LINK, FIXTURE, 0)) as unknown as { id: string }[];
    fakes.scoring.addOtherScorerEvent('core.void', { event_id: web[web.length - 1].id });
    runner.dispatch({ kind: 'read' });
    await wait(10);
    expect(askOf(stateOf(runner))).toBeNull();
    expect(lines(fakes, 'scoring.asked')).toHaveLength(1);
    expect(lines(fakes, 'scoring.asked')[0].fields).toMatchObject({ answer: 'moot' });
    // The web's four, its rally and the void of it, and the phone's two taps.
    expect(await ledgerSize(fakes)).toBe(8);
  });
});

describe('the question across a kill', () => {
  it('stands again when the match is reopened, holds the taps however long the wait, and asks as a new session would', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const first = await reconnected(fakes);
    await first.stop();
    const runner = await open(fakes);
    await wait(120);
    expect(askOf(stateOf(runner))).toEqual({ foreign: 1, queued: 2 });
    expect(await ledgerSize(fakes)).toBe(5);
    expect(lines(fakes, 'scoring.ask')).toHaveLength(2);
    runner.dispatch({ kind: 'answerAsk', answer: 'send' });
    await wait(10);
    expect(await ledgerSize(fakes)).toBe(7);
  });

  it('is said the moment the match opens, not at its next step', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const first = await reconnected(fakes);
    await first.stop();
    const again = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'focused' });
    await again.start();
    expect(lines(fakes, 'scoring.ask')).toHaveLength(2);
  });

  it('is in the queue file the first run saved, the ids it is about', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    await reconnected(fakes);
    expect((await fakes.tapQueue.load(FIXTURE))?.askedAbout).toHaveLength(1);
  });
});

describe('a sender with no screen', () => {
  /** The same evening, the focused runner having left with its two taps queued. */
  async function leftQueued(fakes: FakePorts): Promise<void> {
    const first = await reconnected(fakes);
    await first.stop();
    fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: HOME });
  }

  it('holds the queue without asking: the file keeps the question, the record says nothing, it lets itself go', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    midMatch(fakes);
    const first = await open(fakes);
    fakes.scoring.goOffline(true);
    first.dispatch(tap(RALLY, 'k1'));
    first.dispatch(tap(RALLY, 'k2'));
    await wait(3);
    await first.stop();
    fakes.scoring.addOtherScorerEvent('badminton.rally', { wonBy: AWAY });
    fakes.scoring.goOffline(false);
    const idle = vi.fn();
    const runner = await open(fakes, 'headless', idle);
    await wait(120);
    expect(await ledgerSize(fakes)).toBe(5);
    expect(stateOf(runner).sync.queue.pending.map((item) => item.key)).toEqual(['k1', 'k2']);
    expect((await fakes.tapQueue.load(FIXTURE))?.askedAbout).toHaveLength(1);
    expect(lines(fakes, 'scoring.ask')).toHaveLength(0);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('leaves the question to the screen that opens next, which asks and sends nothing until it is answered', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    await leftQueued(fakes);
    const runner = await open(fakes);
    await wait(60);
    expect(askOf(stateOf(runner))).toMatchObject({ queued: 2 });
    expect(await ledgerSize(fakes)).toBe(6);
  });
});
