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

// MD-2 final review I1: a match opened from Match Day but never tapped has no queue file, so no sweep ever names it.
// Before Match Day lets go of its list, the hub lets go of each such match (`leave`: its link and boot cache go, its own
// tap ids stay a day), unless something still holds it. A match with a queue keeps its link by S2's tidy rule.

/** A match viewed from Match Day and never tapped: its link and boot cache, no queue file, and no day code saved. */
async function viewed(id = FIXTURE, seed: Record<string, string> = {}): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock, kvSeed: seed });
  await saveScoringLink(fakes.kv, id, LINK, HOST, 'badminton');
  const read = await fakes.scoring.bootstrap(LINK);
  if (read.kind !== 'ok') throw new Error('the fake serves the match');
  await fakes.tapQueue.saveBoot(id, { bootstrap: read.bootstrap, toss: null, picks: NO_PICKS });
  await fakes.ports.matchDayStore.addOpened(id);
  await fakes.ports.modeStore.load();
  return fakes;
}

const goneAll = async (fakes: FakePorts, id = FIXTURE): Promise<boolean> =>
  (await readScoringLink(fakes.kv, id, HOST)).kind === 'none' &&
  (await fakes.tapQueue.loadBoot(id)) === null;

const recorded = (fakes: FakePorts, event: string): boolean =>
  readRecord(fakes.record).some((l) => l.event === event);

describe('the heal lets go of a match Match Day opened that was never tapped (final review I1)', () => {
  it('viewed through the pad (focus, ready, release with no taps), then the day goes: link and boot cache go', async () => {
    const fakes = createFakePorts({ clock: timerClock, kvSeed: DAY_SEED });
    await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST, 'badminton');
    await fakes.ports.matchDayStore.addOpened(FIXTURE);
    await fakes.ports.modeStore.load();
    const hub = scoringHubOf(fakes.ports);
    const handle = hub.focus(FIXTURE);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handle.runner.snapshot().kind).toBe('ready');
    expect(await fakes.tapQueue.loadBoot(FIXTURE)).not.toBeNull();
    handle.release();
    await vi.advanceTimersByTimeAsync(1_000);
    // The day still holds it: nothing goes.
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    await fakes.kv.delete(STORE_KEYS.code('matchday'));
    await fakes.ports.modeStore.load();
    await hub.resume();
    expect(await goneAll(fakes)).toBe(true);
    expect(await fakes.ports.matchDayStore.opened()).toEqual([]);
  });

  it('a code that ended (no day code) with a match viewed and no taps: the next resume lets it go', async () => {
    const fakes = await viewed();
    await scoringHubOf(fakes.ports).resume();
    expect(await goneAll(fakes)).toBe(true);
    expect(await fakes.ports.matchDayStore.opened()).toEqual([]);
  });

  it('a match with taps queued keeps its link until its queue empties; the untapped one goes now', async () => {
    const fakes = await viewed();
    await saveScoringLink(fakes.kv, OTHER, LINK, HOST, 'badminton');
    await fakes.tapQueue.save({
      fixtureId: OTHER,
      label: 'Match 5',
      pending: [queuedOf('k1', rally('H'))],
      ownEventIds: [],
      dead: null,
      askedAbout: ['k1'],
    });
    await fakes.ports.matchDayStore.addOpened(OTHER);
    await scoringHubOf(fakes.ports).resume();
    expect(await goneAll(fakes)).toBe(true);
    expect((await readScoringLink(fakes.kv, OTHER, HOST)).kind).toBe('link');
    expect((await fakes.tapQueue.load(OTHER))?.pending).toHaveLength(1);
    expect(await fakes.ports.matchDayStore.opened()).toEqual([]);
  });

  it('the focused match is untouched and stays on the list; its release lets it go', async () => {
    const fakes = await viewed();
    const hub = scoringHubOf(fakes.ports);
    const handle = hub.focus(FIXTURE);
    await vi.advanceTimersByTimeAsync(1_000);
    await hub.resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    expect(await fakes.tapQueue.loadBoot(FIXTURE)).not.toBeNull();
    expect(await fakes.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    handle.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await goneAll(fakes)).toBe(true);
    expect(await fakes.ports.matchDayStore.opened()).toEqual([]);
  });

  it('the saved Remote Scoring match is never let go by it', async () => {
    const fakes = await viewed(FIXTURE, {
      [STORE_KEYS.code('scoring')]: encodeSavedCode({
        mode: 'scoring',
        raw: '',
        slot: null,
        savedAt: new Date('2026-11-12T09:00:00.000Z'),
        expiresAt: null,
        stream: null,
        scoring: { fixtureId: FIXTURE, label: 'Match 4' },
      }),
    });
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    expect(await fakes.ports.matchDayStore.opened()).toEqual([FIXTURE]);
  });

  it('a scan that claims the match while the queues are read keeps it', async () => {
    const fakes = await viewed();
    const hub = scoringHubOf(fakes.ports);
    let release = (): void => undefined;
    const list = fakes.tapQueue.listKnown.bind(fakes.tapQueue);
    vi.spyOn(fakes.tapQueue, 'listKnown').mockImplementationOnce(async () => {
      release = hub.claim(FIXTURE);
      return list();
    });
    await hub.resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    expect(await fakes.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    release();
  });

  it('a refused delete of the link keeps the match on the list, is recorded, and the next resume lets it go', async () => {
    const fakes = await viewed();
    await fakes.ports.matchDayStore.addOpened('left-by-a-dismiss');
    const real = fakes.kv.delete.bind(fakes.kv);
    const refuse = vi
      .spyOn(fakes.kv, 'delete')
      .mockImplementation((key) =>
        key === `scoring.link.${FIXTURE}` ? Promise.reject(new Error('refused')) : real(key),
      );
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    expect(await fakes.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    expect(recorded(fakes, 'matchday.let-go-refused')).toBe(true);
    refuse.mockRestore();
    await scoringHubOf(fakes.ports).resume();
    expect(await goneAll(fakes)).toBe(true);
    expect(await fakes.ports.matchDayStore.opened()).toEqual([]);
  });

  it('a queue folder the phone cannot list lets go of nothing and keeps the list (it is never read as no queue)', async () => {
    const fakes = await viewed();
    vi.spyOn(fakes.tapQueue, 'listKnown').mockResolvedValueOnce(null);
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    expect(await fakes.ports.matchDayStore.opened()).toEqual([FIXTURE]);
    expect(recorded(fakes, 'matchday.heal-refused')).toBe(true);
  });

  it('a list the phone will not read lets go of nothing', async () => {
    const fakes = await viewed();
    vi.spyOn(fakes.ports.matchDayStore, 'openedKnown').mockResolvedValue(null);
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
  });

  it('a day still saved: nothing is let go by the heal', async () => {
    const fakes = await viewed(FIXTURE, DAY_SEED);
    await scoringHubOf(fakes.ports).resume();
    expect((await readScoringLink(fakes.kv, FIXTURE, HOST)).kind).toBe('link');
    expect(await fakes.tapQueue.loadBoot(FIXTURE)).not.toBeNull();
    expect(await fakes.ports.matchDayStore.opened()).toEqual([FIXTURE]);
  });

  it('the record names no fixture, link or token', async () => {
    const fakes = await viewed();
    vi.spyOn(fakes.kv, 'delete').mockRejectedValue(new Error('refused'));
    await scoringHubOf(fakes.ports).resume();
    const text = JSON.stringify(readRecord(fakes.record));
    expect(text).not.toContain(FIXTURE);
    expect(text).not.toContain(FAKE_SCORING_SECRET);
  });
});
