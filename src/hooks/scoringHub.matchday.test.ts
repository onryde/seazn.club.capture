import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSavedCode } from '@/domain/mode/savedCode';
import { STORE_KEYS } from '@/services/modeStore';
import { dayLink } from '../../test/fixtures/dayCode';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import type { MatchQueue } from '@/domain/scoring/queue';
import { scoringHubOf } from '@/hooks/scoringHub';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { readScoringLink, saveScoringLink } from '@/services/scoringLinkStore';
import { ledgerOf, queuedOf, rally, start } from '../../test/badmintonLedger';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// Review Focus 1 (MD-2 Task 5): a match opened from Match Day is not swept when its queue empties, because Match Day
// holds it (S4 design §3, §6: its link is "forgotten by S2's own rules, not by Exit while it still has taps to send").
// The hub's sweep takes a match nothing wants; Match Day's opened set is one more thing that wants it.

const FIXTURE = SINGLES_SEED.fixtureId;
const OTHER = 'fake-doubles';
/** A saved day code: Match Day holds its opened matches only while one is saved (review I2). */
const DAY_SEED = {
  [STORE_KEYS.code('matchday')]: encodeSavedCode({
    mode: 'matchday',
    raw: dayLink(),
    slot: null,
    savedAt: new Date('2026-11-12T09:00:00.000Z'),
    expiresAt: null,
    stream: null,
    scoring: null,
  }),
};
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T09:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

/** A match left behind with nothing to send: its link, an empty queue file, its ledger and its boot cache. */
async function leftover(id: string): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, kvSeed: DAY_SEED });
  await saveScoringLink(fakes.kv, id, LINK, HOST, 'badminton');
  const read = await fakes.scoring.bootstrap(LINK);
  if (read.kind !== 'ok') throw new Error('the fake serves the match');
  await fakes.tapQueue.saveBoot(id, { bootstrap: read.bootstrap, toss: null, picks: NO_PICKS });
  await fakes.tapQueue.saveLedger(id, ledgerOf([start()]));
  const empty: MatchQueue = {
    fixtureId: id,
    label: 'Match 4',
    pending: [],
    ownEventIds: [],
    dead: null,
  };
  await fakes.tapQueue.save(empty);
  await fakes.ports.modeStore.load();
  return fakes;
}

const kept = async (fakes: FakePorts, id = FIXTURE): Promise<boolean> =>
  (await readScoringLink(fakes.kv, id, HOST)).kind === 'link' &&
  (await fakes.tapQueue.load(id)) !== null &&
  (await fakes.tapQueue.loadLedger(id)) !== null &&
  (await fakes.tapQueue.loadBoot(id)) !== null;

describe('a match Match Day opened is spared by the hub’s sweep', () => {
  it('a match whose queue empties is not swept while Match Day holds it', async () => {
    const fakes = await leftover(FIXTURE);
    await fakes.ports.matchDayStore.addOpened(FIXTURE);
    await scoringHubOf(fakes.ports).resume();
    expect(await kept(fakes)).toBe(true);
  });

  it('the same match not held by Match Day is swept (the guard is the only thing sparing it)', async () => {
    const fakes = await leftover(FIXTURE);
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('none');
    expect(await fakes.tapQueue.load(FIXTURE)).toBeNull();
  });

  it('spares only the opened ones: another leftover in the same resume is swept', async () => {
    const fakes = await leftover(FIXTURE);
    await saveScoringLink(fakes.kv, OTHER, LINK, HOST, 'badminton');
    await fakes.tapQueue.save({
      fixtureId: OTHER,
      label: 'Match 5',
      pending: [],
      ownEventIds: [],
      dead: null,
    });
    await fakes.ports.matchDayStore.addOpened(FIXTURE);
    await scoringHubOf(fakes.ports).resume();
    expect(await kept(fakes)).toBe(true);
    expect((await readScoringLink(fakes.kv, OTHER, HOST)).kind).toBe('none');
  });

  it('a drained headless sender’s clean-up spares it too', async () => {
    const fakes = createFakePorts({ clock: timerClock, kvSeed: DAY_SEED });
    await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
    await fakes.tapQueue.save({
      fixtureId: FIXTURE,
      label: 'Match 4',
      pending: [queuedOf('k1', rally('H'))],
      ownEventIds: [],
      dead: null,
    });
    await fakes.ports.matchDayStore.addOpened(FIXTURE);
    await fakes.ports.modeStore.load();
    await scoringHubOf(fakes.ports).resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
  });

  it('a list the phone will not read fails closed: nothing is swept this round, and the next readable one decides', async () => {
    const fakes = await leftover(FIXTURE);
    const read = vi.spyOn(fakes.ports.matchDayStore, 'openedKnown').mockResolvedValueOnce(null);
    await scoringHubOf(fakes.ports).resume();
    expect(await kept(fakes)).toBe(true);
    read.mockRestore();
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('none');
  });
});

describe('a list with no day behind it spares nothing (Exit that died or was refused between its steps)', () => {
  it('opened ids and no day code: the empty queue is swept, and the stale list is cleared at the same resume', async () => {
    const fakes = await leftover(FIXTURE);
    await fakes.kv.delete(STORE_KEYS.code('matchday'));
    await fakes.ports.modeStore.load();
    await fakes.ports.matchDayStore.addOpened(FIXTURE);
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('none');
    expect(await fakes.ports.matchDayStore.opened()).toEqual([]);
  });

  it('a stale list that cannot be cleared is recorded, and still spares nothing', async () => {
    const fakes = await leftover(FIXTURE);
    await fakes.kv.delete(STORE_KEYS.code('matchday'));
    await fakes.ports.modeStore.load();
    await fakes.ports.matchDayStore.addOpened(FIXTURE);
    vi.spyOn(fakes.ports.matchDayStore, 'clearOpened').mockRejectedValue(new Error('refused'));
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('none');
    expect(readRecord(fakes.record).some((l) => l.event === 'matchday.heal-refused')).toBe(true);
  });

  it('a note of a match no longer sending is dropped at a resume; one still sending stays', async () => {
    const fakes = await leftover(FIXTURE);
    await fakes.tapQueue.save({
      fixtureId: OTHER,
      label: 'Match 5',
      pending: [queuedOf('k1', rally('H'))],
      ownEventIds: [],
      dead: null,
      askedAbout: ['k1'],
    });
    await fakes.ports.matchDayStore.addSending(
      new Map([
        [FIXTURE, 'Court 2'],
        [OTHER, 'Court 3'],
        ['gone', ''],
      ]),
    );
    await scoringHubOf(fakes.ports).resume();
    expect([...(await fakes.ports.matchDayStore.sending())].map(([id]) => id)).toEqual([OTHER]);
  });
});

describe('the heal waits for what it cannot judge', () => {
  it('a store that has not loaded says nothing: the list stays and nothing is recorded', async () => {
    const fakes = createFakePorts({ clock: timerClock, kvSeed: DAY_SEED });
    await fakes.ports.matchDayStore.addOpened(FIXTURE);
    await scoringHubOf(fakes.ports).resume();
    expect(await fakes.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    expect(readRecord(fakes.record).some((l) => l.event === 'matchday.heal-refused')).toBe(false);
  });

  it('a note of a queue the phone cannot read stays: it may still hold taps', async () => {
    const fakes = await leftover(FIXTURE);
    fakes.queueFiles.files.set(`${FIXTURE}.json`, '{garbled');
    await fakes.ports.matchDayStore.addSending(new Map([[FIXTURE, 'Court 2']]));
    await scoringHubOf(fakes.ports).resume();
    expect((await fakes.ports.matchDayStore.sending()).size).toBe(1);
  });
});

describe('the sweep reads Match Day’s list across an await', () => {
  it('a scan that claims the match while the list is read keeps it', async () => {
    const fakes = await leftover(FIXTURE);
    const hub = scoringHubOf(fakes.ports);
    let release = (): void => undefined;
    vi.spyOn(fakes.ports.matchDayStore, 'openedKnown').mockImplementation(async () => {
      release = hub.claim(FIXTURE);
      return [];
    });
    await hub.resume();
    expect(await kept(fakes)).toBe(true);
    release();
  });

  it('a screen that focuses the match while the list is read keeps it', async () => {
    const fakes = await leftover(FIXTURE);
    const hub = scoringHubOf(fakes.ports);
    let handle: ReturnType<typeof hub.focus> | null = null;
    vi.spyOn(fakes.ports.matchDayStore, 'openedKnown').mockImplementation(async () => {
      handle = hub.focus(FIXTURE);
      return [];
    });
    await hub.resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    (handle as { release(): void } | null)?.release();
  });

  it('the match saved while the list is read keeps it', async () => {
    const fakes = await leftover(FIXTURE);
    const hub = scoringHubOf(fakes.ports);
    vi.spyOn(fakes.ports.matchDayStore, 'openedKnown').mockImplementation(async () => {
      await fakes.ports.modeStore.open({
        mode: 'scoring',
        raw: '',
        slot: null,
        savedAt: new Date('2026-11-12T09:00:00.000Z'),
        expiresAt: null,
        stream: null,
        scoring: { fixtureId: FIXTURE, label: 'Match 4' },
      });
      return [];
    });
    await hub.resume();
    expect(await kept(fakes)).toBe(true);
  });
});
