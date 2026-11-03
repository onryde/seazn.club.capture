import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import { dismissMatch, keepScoringLink, letGoOfScoring } from '@/hooks/scoringOpen';
import { scoringHubOf, type FocusHandle } from '@/hooks/scoringHub';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { readScoringLink, saveScoringLink } from '@/services/scoringLinkStore';
import { createTapQueueStore } from '@/services/tapQueueStore';
import { queuedOf, rally } from '../../test/badmintonLedger';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// A scorer who scans another court's code by mistake and then scans their own again (owner ruling 46, 2026-11-03):
// letting the first match go keeps the ids of this phone's own taps for a day, so on the rescan History says "this
// phone" and Undo reaches the latest tap. Over the real hub, runner, queue store (on an in-memory folder) and the fake
// server, which folds with the real engine.

const FIXTURE = SINGLES_SEED.fixtureId;
const OTHER_COURT = 'fx-other-court';
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const AT = '2026-11-03T09:00:00.000Z';
const HOUR = 3_600_000;
/** The clock moves on without running the fake engine's every tick in between. */
const later = (ms: number): void => {
  vi.setSystemTime(Date.now() + ms);
};
const START: BadmintonTap = { kind: 'start', server: 'first' };
const RALLY: BadmintonTap = { kind: 'rally', side: 'first' };

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AT));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The scorer's own match, scored online (a start and a rally, both accepted) and left with the pad. */
async function played(): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
  const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
  await flush();
  handle.runner.dispatch({ kind: 'tap', tap: START, key: 'k1', at: AT });
  await flush();
  handle.runner.dispatch({ kind: 'tap', tap: RALLY, key: 'k2', at: AT });
  await flush();
  handle.release();
  await flush();
  expect((await fakes.tapQueue.load(FIXTURE))?.ownEventIds).toHaveLength(2);
  return fakes;
}

/** Another court's match with taps already sent, and its link: what a mis-scan opened. */
async function otherCourt(fakes: FakePorts): Promise<void> {
  await saveScoringLink(fakes.kv, OTHER_COURT, LINK, HOST, 'badminton');
  await fakes.tapQueue.save({
    fixtureId: OTHER_COURT,
    label: 'Court 9',
    pending: [],
    ownEventIds: ['ev-other-1'],
    dead: null,
  });
}

/** The scan of the scorer's own match again, as Home does it: the link kept, then the pad's runner on the match. */
async function rescan(fakes: FakePorts): Promise<FocusHandle> {
  const kept = await keepScoringLink(fakes.ports, LINK.token, {
    kind: 'scan',
    match: { fixtureId: FIXTURE, label: 'Match 4' },
    sportKey: 'badminton',
  });
  kept.release();
  const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
  await flush();
  return handle;
}

function padOf(handle: FocusHandle) {
  const snapshot = handle.runner.snapshot();
  if (snapshot.kind !== 'ready') throw new Error(`expected a match, got ${snapshot.kind}`);
  const view = viewOf(snapshot.state);
  if (view.kind !== 'pad') throw new Error(`expected the pad, got ${view.kind}`);
  return view;
}

const whoRecorded = (handle: FocusHandle): string[] =>
  padOf(handle).history.flatMap((group) => group.rows.map((row) => row.by));

const ledgerTypes = async (fakes: FakePorts): Promise<string[]> => {
  const events = await fakes.scoring.events(LINK, FIXTURE, 0);
  return Array.isArray(events) ? events.map((event) => event.type) : [];
};

describe('scanning another match by mistake, then the scorer’s own again', () => {
  it('within a day: History says it was this phone, and Undo takes back the latest tap', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    expect(await fakes.tapQueue.load(FIXTURE)).toBeNull();
    later(23 * HOUR);
    const again = await rescan(fakes);
    expect(whoRecorded(again)).toEqual(['thisPhone', 'thisPhone']);
    expect(padOf(again).view.lastTap?.undo).toBe(true);
    expect(padOf(again).line).toBeNull();
    again.runner.dispatch({ kind: 'undo', key: 'u1', at: AT });
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally', 'core.void']);
  });

  it('after more than a day the ids are gone: the same taps read "another scorer" and Undo is off', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    later(24 * HOUR + 1);
    const again = await rescan(fakes);
    expect(whoRecorded(again)).toEqual(['otherScorer', 'otherScorer']);
    expect(padOf(again).view.lastTap?.undo).toBe(false);
  });

  it('at exactly a day the ids are still this phone’s', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    later(24 * HOUR);
    expect(whoRecorded(await rescan(fakes))).toEqual(['thisPhone', 'thisPhone']);
  });

  it('a second mis-scan while the first is kept: both matches keep their ids, each for its own day', async () => {
    const fakes = await played();
    await otherCourt(fakes);
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    later(10 * HOUR);
    await letGoOfScoring(fakes.ports, OTHER_COURT, 'fx-third-court');
    expect(await fakes.tapQueue.loadKept(FIXTURE, fakes.ports.clock().getTime())).toHaveLength(2);
    expect(await fakes.tapQueue.loadKept(OTHER_COURT, fakes.ports.clock().getTime())).toEqual([
      'ev-other-1',
    ]);
    later(10 * HOUR);
    expect(whoRecorded(await rescan(fakes))).toEqual(['thisPhone', 'thisPhone']);
  });

  it('the app killed between leaving and scanning: a fresh launch on the same disk still finds them', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    const cold = createFakePorts({
      clock: timerClock,
      scoring: fakes.scoring,
      kv: fakes.kv,
      tapQueue: createTapQueueStore({ files: fakes.queueFiles, logger: fakes.ports.logger }),
    });
    later(2 * HOUR);
    await cold.ports.modeStore.load();
    await scoringHubOf(cold.ports).resume();
    expect(whoRecorded(await rescan(cold))).toEqual(['thisPhone', 'thisPhone']);
  });

  it('through the launch sweeps: a day old and a resume, the entry is gone, and so are the ids', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    later(24 * HOUR + 1);
    await fakes.ports.modeStore.load();
    await scoringHubOf(fakes.ports).resume();
    expect([...fakes.queueFiles.files.keys()]).toEqual([]);
    expect(whoRecorded(await rescan(fakes))).toEqual(['otherScorer', 'otherScorer']);
  });

  it('the scorer’s kept ids and their own taps since: leaving again keeps the whole set', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    const again = await rescan(fakes);
    again.runner.dispatch({ kind: 'tap', tap: RALLY, key: 'k3', at: AT });
    await flush();
    again.release();
    await flush();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    expect(await fakes.tapQueue.loadKept(FIXTURE, fakes.ports.clock().getTime())).toHaveLength(3);
    expect(whoRecorded(await rescan(fakes))).toEqual(['thisPhone', 'thisPhone', 'thisPhone']);
  });

  it('a kept file that cannot be read is said once and ignored: the match opens, its taps another scorer’s', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    fakes.queueFiles.files.set(`${FIXTURE}.own.json`, '{ not json');
    const again = await rescan(fakes);
    expect(whoRecorded(again)).toEqual(['otherScorer', 'otherScorer']);
    const said = readRecord(fakes.record).filter(
      (line) => line.event === 'scoring.kept.unreadable',
    );
    expect(said).toHaveLength(1);
    expect(said[0]?.fields).toEqual({ problem: 'garbled' });
  });

  it('a kept file that names a different match’s id changes nothing for this one', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    const kept = fakes.queueFiles.files.get(`${FIXTURE}.own.json`) ?? '';
    fakes.queueFiles.files.set(`${FIXTURE}.own.json`, kept.replace(FIXTURE, 'fx-someone-else'));
    expect(whoRecorded(await rescan(fakes))).toEqual(['otherScorer', 'otherScorer']);
  });
});

describe('what leaving does not change', () => {
  it('a match with taps still unsent is not let go: its queue, link and taps stay, and nothing is kept', async () => {
    const fakes = await played();
    const queue = await fakes.tapQueue.load(FIXTURE);
    if (queue === null) throw new Error('the pad left its queue');
    await fakes.tapQueue.save({ ...queue, pending: [queuedOf('k9', rally('H'))] });
    await letGoOfScoring(fakes.ports, FIXTURE, OTHER_COURT);
    expect((await fakes.tapQueue.load(FIXTURE))?.pending).toHaveLength(1);
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    expect(await fakes.tapQueue.loadKept(FIXTURE, fakes.ports.clock().getTime())).toBeNull();
  });

  it('the same match scanned again is not let go, and a first match (nothing replaced) lets go of nothing', async () => {
    const fakes = await played();
    await letGoOfScoring(fakes.ports, FIXTURE, FIXTURE);
    await letGoOfScoring(fakes.ports, null, FIXTURE);
    expect((await fakes.tapQueue.load(FIXTURE))?.ownEventIds).toHaveLength(2);
    expect(await fakes.tapQueue.loadKept(FIXTURE, fakes.ports.clock().getTime())).toBeNull();
  });

  it('a match that has a queue file takes its ids from that file: an older kept file is not read', async () => {
    const fakes = await played();
    const own = (await fakes.tapQueue.load(FIXTURE))?.ownEventIds ?? [];
    const stale = { v: 1, fixtureId: FIXTURE, ownEventIds: ['ev-stale'], leftAt: Date.now() };
    fakes.queueFiles.files.set(`${FIXTURE}.own.json`, JSON.stringify(stale));
    const kept = vi.spyOn(fakes.tapQueue, 'loadKept');
    const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    const snapshot = handle.runner.snapshot();
    expect(snapshot.kind === 'ready' && snapshot.state.sync.queue.ownEventIds).toEqual(own);
    expect(kept).not.toHaveBeenCalled();
  });

  it('Dismiss (the operator’s word, or Close on a finished match) keeps no ids: a rescan reads them as another scorer’s', async () => {
    const fakes = await played();
    await dismissMatch(fakes.ports, FIXTURE);
    expect([...fakes.queueFiles.files.keys()]).toEqual([]);
    expect(whoRecorded(await rescan(fakes))).toEqual(['otherScorer', 'otherScorer']);
  });
});
