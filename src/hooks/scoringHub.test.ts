import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { MatchQueue } from '@/domain/scoring/queue';
import { scoringHubOf, type FocusHandle } from '@/hooks/scoringHub';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { readScoringLink, saveScoringLink } from '@/services/scoringLinkStore';
import { queuedOf, rally } from '../../test/badmintonLedger';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// Who runs which match (plan S2-1 Task 9) over the real runners, the real queue store on an in-memory folder and the
// fake server. A runner subscribes to the foreground once, and the live owner once more, so "who is running" is read
// off `foreground.returnListeners()`: a focused match is 2, a headless sender 1, a stopped match 0.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const AT = '2026-11-02T09:00:00.000Z';
const START: BadmintonTap = { kind: 'start', server: 'first' };

async function flush(): Promise<void> {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
}

async function rig(): Promise<FakePorts> {
  const fakes = createFakePorts({ clock: timerClock });
  await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST);
  return fakes;
}

const listeners = (fakes: FakePorts): number => fakes.foreground.returnListeners();

/** A queue with one tap for a match that has a link saved, so a sender has something to do. */
async function queued(fakes: FakePorts, id: string, over: Partial<MatchQueue> = {}): Promise<void> {
  await saveScoringLink(fakes.kv, id, LINK, HOST);
  await fakes.tapQueue.save({
    fixtureId: id,
    label: 'A. Sharma v L. Chen',
    pending: [queuedOf('k1', rally('H'))],
    ownEventIds: [],
    dead: null,
    ...over,
  });
}

const ledgerTypes = async (fakes: FakePorts): Promise<string[]> => {
  const events = await fakes.scoring.events(LINK, FIXTURE, 0);
  return Array.isArray(events) ? events.map((event) => event.type) : [];
};

/** Focuses the match, taps Start while the server is away, and leaves: one tap queued for a sender. */
async function leftWithOneTap(fakes: FakePorts): Promise<void> {
  const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
  await flush();
  fakes.scoring.goOffline(true);
  handle.runner.dispatch({ kind: 'tap', tap: START, key: 'k1', at: AT });
  await flush();
  handle.release();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the hub', () => {
  it('is one per Ports', async () => {
    const one = createFakePorts();
    const other = createFakePorts();
    expect(scoringHubOf(one.ports)).toBe(scoringHubOf(one.ports));
    expect(scoringHubOf(one.ports)).not.toBe(scoringHubOf(other.ports));
  });
});

describe('focusing a match', () => {
  it('opens it and joins its channel with the live owner', async () => {
    const fakes = await rig();
    const { runner } = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect(runner.snapshot().kind).toBe('ready');
    expect(fakes.realtime.subscriptions).toHaveLength(1);
    expect(fakes.realtime.subscriptions[0].grant.channel).toBe('fixture:fake-singles');
    expect(listeners(fakes)).toBe(2);
  });

  it('twice is one runner, run once, until the last release', async () => {
    const fakes = await rig();
    const hub = scoringHubOf(fakes.ports);
    const first = hub.focus(FIXTURE);
    const second = hub.focus(FIXTURE);
    await flush();
    expect(second.runner).toBe(first.runner);
    expect(listeners(fakes)).toBe(2);
    first.release();
    await flush();
    expect(listeners(fakes)).toBe(2);
    expect(first.runner.dispatch({ kind: 'pickServer', side: 'first' })).toBeNull();
    second.release();
    await flush();
    expect(listeners(fakes)).toBe(0);
    expect(fakes.realtime.subscriptions.map((one) => one.open)).toEqual([false]);
  });

  it('a handle released twice releases once: the other screen keeps the match', async () => {
    const fakes = await rig();
    const hub = scoringHubOf(fakes.ports);
    const first = hub.focus(FIXTURE);
    hub.focus(FIXTURE);
    await flush();
    first.release();
    first.release();
    await flush();
    expect(listeners(fakes)).toBe(2);
  });

  it('released before it has opened never joins the channel and leaves nothing running', async () => {
    const fakes = await rig();
    const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
    handle.release();
    await flush();
    expect(listeners(fakes)).toBe(0);
    expect(fakes.realtime.subscriptions).toHaveLength(0);
  });

  it('with no link saved is a runner that says so, and no channel', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    const { runner } = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect(runner.snapshot()).toEqual({ kind: 'noLink' });
    expect(fakes.realtime.subscriptions).toHaveLength(0);
  });
});

describe('coming back to a match a runner is still saving', () => {
  it('opens only once the saves have landed, and finds the tap in its queue', async () => {
    const fakes = await rig();
    const hub = scoringHubOf(fakes.ports);
    const first = hub.focus(FIXTURE);
    await flush();
    fakes.scoring.goOffline(true);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = fakes.tapQueue.save;
    vi.spyOn(fakes.tapQueue, 'save').mockImplementation(async (queue) => {
      await gate;
      return real(queue);
    });
    first.runner.dispatch({ kind: 'tap', tap: START, key: 'k1', at: AT });
    await flush();
    first.release();
    const second = hub.focus(FIXTURE);
    await flush();
    expect(second.runner.snapshot()).toEqual({ kind: 'loading' });
    open();
    await flush();
    const snapshot = second.runner.snapshot();
    expect(
      snapshot.kind === 'ready' ? snapshot.state.sync.queue.pending.map((tap) => tap.key) : [],
    ).toEqual(['k1']);
  });
});

describe('leaving a match', () => {
  it('with taps unsent hands them to a sender that sends them, never joins the channel, and lets go', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    expect(listeners(fakes)).toBe(1);
    expect(fakes.realtime.subscriptions).toHaveLength(1);
    fakes.scoring.goOffline(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
    expect(listeners(fakes)).toBe(0);
    expect(fakes.realtime.subscriptions).toHaveLength(1);
    expect(fakes.realtime.subscriptions[0].open).toBe(false);
  });

  it('with nothing queued starts no sender', async () => {
    const fakes = await rig();
    const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    handle.release();
    await flush();
    expect(listeners(fakes)).toBe(0);
  });

  it('and coming back stops that sender first: one sender at a time, the tap still queued', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    expect(listeners(fakes)).toBe(1);
    const again = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect(listeners(fakes)).toBe(2);
    const snapshot = again.runner.snapshot();
    expect(
      snapshot.kind === 'ready' ? snapshot.state.sync.queue.pending.map((tap) => tap.key) : [],
    ).toEqual(['k1']);
  });

  it('mid-wait for an Undo hands the sender the tap and its Undo: both go, the void of what the answer names', async () => {
    const fakes = await rig();
    const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    handle.runner.dispatch({ kind: 'tap', tap: START, key: 'k1', at: AT });
    await flush();
    fakes.scoring.dropNextAnswer();
    handle.runner.dispatch({
      kind: 'tap',
      tap: { kind: 'rally', side: 'first' },
      key: 'k2',
      at: AT,
    });
    await flush();
    handle.runner.dispatch({ kind: 'undo', key: 'u1', at: AT });
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
    handle.release();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally', 'core.void']);
    expect(listeners(fakes)).toBe(0);
    expect((await fakes.tapQueue.load(FIXTURE))?.pending).toEqual([]);
  });

  it('leaves the sender for good once the match is decided: a dead queue is not retried', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    fakes.scoring.goOffline(false);
    fakes.scoring.revoke();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listeners(fakes)).toBe(0);
    const left = await fakes.tapQueue.load(FIXTURE);
    expect(left?.dead).toBe('LINK_REVOKED');
    expect(left?.pending.map((tap) => tap.key)).toEqual(['k1']);
  });
});

describe('resuming the senders (a launch, a return)', () => {
  it('starts one for each match with live taps queued, and for no other', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    fakes.scoring.goOffline(true);
    await queued(fakes, 'm-live');
    await queued(fakes, 'm-empty', { pending: [] });
    await queued(fakes, 'm-dead', { dead: 'finalized' });
    fakes.queueFiles.files.set('m-garbled.json', '{ not json');
    const touched = new Set<string>();
    const real = fakes.tapQueue.load;
    vi.spyOn(fakes.tapQueue, 'load').mockImplementation(async (fixtureId) => {
      touched.add(fixtureId);
      return real(fixtureId);
    });
    await scoringHubOf(fakes.ports).resume();
    await flush();
    expect(listeners(fakes)).toBe(1);
    expect([...touched]).toEqual(['m-live']);
  });

  it('can start a sender again for a match whose last one let go', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    fakes.scoring.goOffline(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listeners(fakes)).toBe(0);
    fakes.scoring.goOffline(true);
    await queued(fakes, FIXTURE);
    await scoringHubOf(fakes.ports).resume();
    await flush();
    expect(listeners(fakes)).toBe(1);
  });

  it('waits for a runner still saving the match before it reads the queue', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    const hub = scoringHubOf(fakes.ports);
    const handle = hub.focus(FIXTURE);
    await flush();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = fakes.tapQueue.save;
    vi.spyOn(fakes.tapQueue, 'save').mockImplementation(async (queue) => {
      await gate;
      return real(queue);
    });
    handle.runner.dispatch({
      kind: 'tap',
      tap: { kind: 'rally', side: 'first' },
      key: 'k2',
      at: AT,
    });
    await flush();
    handle.release();
    const resuming = hub.resume();
    await flush();
    open();
    await resuming;
    await flush();
    fakes.scoring.goOffline(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
  });

  it('a second call starts no second sender for the same match', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    fakes.scoring.goOffline(true);
    await queued(fakes, 'm-live');
    const hub = scoringHubOf(fakes.ports);
    await Promise.all([hub.resume(), hub.resume()]);
    await hub.resume();
    await flush();
    expect(listeners(fakes)).toBe(1);
  });

  it('leaves a focused match to its screen', async () => {
    const fakes = await rig();
    fakes.scoring.goOffline(true);
    await queued(fakes, FIXTURE);
    const hub = scoringHubOf(fakes.ports);
    hub.focus(FIXTURE);
    await hub.resume();
    await flush();
    expect(listeners(fakes)).toBe(2);
  });

  it('lets go of a match whose link is gone: nothing to send with', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    await fakes.tapQueue.save({
      fixtureId: 'm-nolink',
      label: '',
      pending: [queuedOf('k1', rally('H'))],
      ownEventIds: [],
      dead: null,
    });
    await scoringHubOf(fakes.ports).resume();
    await flush();
    expect(listeners(fakes)).toBe(0);
  });

  it('sends what is queued, in a match the screen never opened this launch', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    const cold = createFakePorts({
      clock: timerClock,
      scoring: fakes.scoring,
      kv: fakes.kv,
      tapQueue: fakes.tapQueue,
    });
    fakes.scoring.goOffline(false);
    await scoringHubOf(cold.ports).resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });
});

describe('handing a match over while a send is out', () => {
  it('never has two calls for one match at once: the next runner opens only after the last one’s call has come back', async () => {
    const fakes = await rig();
    const hub = scoringHubOf(fakes.ports);
    const real = fakes.scoring.append;
    let active = 0;
    let most = 0;
    const gates: Array<() => void> = [];
    const append = vi.spyOn(fakes.scoring, 'append').mockImplementation(async (link, id, body) => {
      active += 1;
      most = Math.max(most, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active -= 1;
      return real(link, id, body);
    });
    const first = hub.focus(FIXTURE);
    await flush();
    first.runner.dispatch({ kind: 'tap', tap: START, key: 'k1', at: AT });
    await flush();
    expect(append).toHaveBeenCalledTimes(1);
    first.release();
    const again = hub.focus(FIXTURE);
    await flush();
    expect(append).toHaveBeenCalledTimes(1);
    gates.shift()?.();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    while (gates.length > 0) {
      gates.shift()?.();
      await flush();
    }
    expect(most).toBe(1);
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
    again.release();
  });
});

describe('dismissing a match', () => {
  it('stops its runner and deletes the queue, the ledger, the boot cache and the link', async () => {
    const fakes = await rig();
    const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    handle.runner.dispatch({ kind: 'tap', tap: START, key: 'k1', at: AT });
    await flush();
    expect([...fakes.queueFiles.files.keys()].sort()).toEqual([
      'fake-singles.boot.json',
      'fake-singles.json',
      'fake-singles.ledger.json',
    ]);
    await scoringHubOf(fakes.ports).dismiss(FIXTURE);
    expect([...fakes.queueFiles.files.keys()]).toEqual([]);
    expect(await readScoringLink(fakes.kv, FIXTURE, HOST)).toEqual({ kind: 'none' });
    expect(handle.runner.dispatch({ kind: 'read' })).toBeNull();
    expect(listeners(fakes)).toBe(0);
    expect(fakes.realtime.subscriptions.map((one) => one.open)).toEqual([false]);
  });

  it('waits for a save in flight, and nothing is written after the delete', async () => {
    const fakes = await rig();
    const handle = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = fakes.tapQueue.save;
    vi.spyOn(fakes.tapQueue, 'save').mockImplementation(async (queue) => {
      await gate;
      return real(queue);
    });
    handle.runner.dispatch({ kind: 'tap', tap: START, key: 'k1', at: AT });
    await flush();
    const removed = vi.fn();
    const dismissing = scoringHubOf(fakes.ports).dismiss(FIXTURE).then(removed);
    await flush();
    expect(removed).not.toHaveBeenCalled();
    expect(fakes.queueFiles.ops.some((op) => op.startsWith('remove'))).toBe(false);
    open();
    await dismissing;
    await flush();
    const lastWrite = fakes.queueFiles.ops.map((op) => op.startsWith('write')).lastIndexOf(true);
    const firstRemove = fakes.queueFiles.ops.findIndex((op) => op.startsWith('remove'));
    expect(firstRemove).toBeGreaterThan(lastWrite);
    expect([...fakes.queueFiles.files.keys()]).toEqual([]);
  });

  it('right after the match was left waits for the runner still saving it, and leaves nothing behind', async () => {
    const fakes = await rig();
    const hub = scoringHubOf(fakes.ports);
    const handle = hub.focus(FIXTURE);
    await flush();
    fakes.scoring.goOffline(true);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = fakes.tapQueue.save;
    vi.spyOn(fakes.tapQueue, 'save').mockImplementation(async (queue) => {
      await gate;
      return real(queue);
    });
    handle.runner.dispatch({ kind: 'tap', tap: START, key: 'k1', at: AT });
    await flush();
    handle.release();
    const dismissing = hub.dismiss(FIXTURE);
    open();
    await dismissing;
    await flush();
    expect([...fakes.queueFiles.files.keys()]).toEqual([]);
  });

  it('stops a headless sender before it deletes', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    expect(listeners(fakes)).toBe(1);
    fakes.scoring.goOffline(false);
    const append = vi.spyOn(fakes.scoring, 'append');
    await scoringHubOf(fakes.ports).dismiss(FIXTURE);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(append).not.toHaveBeenCalled();
    expect(listeners(fakes)).toBe(0);
    expect([...fakes.queueFiles.files.keys()]).toEqual([]);
  });

  it('starts no sender for it meanwhile: a resume that lists its queue while the dismiss is under way sends nothing', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    fakes.scoring.goOffline(false);
    const append = vi.spyOn(fakes.scoring, 'append');
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const realDelete = fakes.kv.delete.bind(fakes.kv);
    vi.spyOn(fakes.kv, 'delete').mockImplementation(async (key) => {
      await gate;
      return realDelete(key);
    });
    const hub = scoringHubOf(fakes.ports);
    const dismissing = hub.dismiss(FIXTURE);
    await flush();
    await hub.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(append).not.toHaveBeenCalled();
    expect(listeners(fakes)).toBe(0);
    open();
    await dismissing;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(append).not.toHaveBeenCalled();
    expect(listeners(fakes)).toBe(0);
    expect(await ledgerTypes(fakes)).toEqual([]);
    expect([...fakes.queueFiles.files.keys()]).toEqual([]);
  });

  it('is over when it returns: the same match scanned again is run again, its sender started', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    const hub = scoringHubOf(fakes.ports);
    await hub.dismiss(FIXTURE);
    expect(listeners(fakes)).toBe(0);
    fakes.scoring.goOffline(true);
    await queued(fakes, FIXTURE);
    await hub.resume();
    expect(listeners(fakes)).toBe(1);
  });

  it('forgets the link before it deletes the files: a stop half way leaves no queue a link could send', async () => {
    const fakes = await rig();
    await leftWithOneTap(fakes);
    const forget = vi.spyOn(fakes.kv, 'delete');
    const remove = vi.spyOn(fakes.tapQueue, 'remove');
    await scoringHubOf(fakes.ports).dismiss(FIXTURE);
    expect(forget).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(forget.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
  });

  it('a match nobody runs is deleted too, and a second dismiss is no failure', async () => {
    const fakes = createFakePorts({ clock: timerClock });
    await queued(fakes, 'm-old');
    const hub = scoringHubOf(fakes.ports);
    await hub.dismiss('m-old');
    await hub.dismiss('m-old');
    expect([...fakes.queueFiles.files.keys()]).toEqual([]);
    expect(await readScoringLink(fakes.kv, 'm-old', HOST)).toEqual({ kind: 'none' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A link that dies under the pad (plan S2-1 Task 10; design §4.3)
// ---------------------------------------------------------------------------------------------------------------

describe('a link that dies with nothing queued', () => {
  const savedMatch = (fixtureId: string) => ({
    mode: 'scoring' as const,
    raw: '',
    slot: null,
    savedAt: new Date('2026-11-02T09:00:00.000Z'),
    expiresAt: null,
    stream: null,
    scoring: { fixtureId, label: 'Match 4' },
  });

  /** A phone that has the match saved (its code and its link), as a scan left it. */
  async function savedRig(fixtureId = FIXTURE): Promise<FakePorts> {
    const fakes = await rig();
    await fakes.ports.modeStore.load();
    await fakes.ports.modeStore.open(savedMatch(fixtureId));
    return fakes;
  }
  const saved = (fakes: FakePorts) => {
    const snapshot = fakes.ports.modeStore.getSnapshot();
    return snapshot.status === 'ready' ? snapshot.saved.codes.scoring : undefined;
  };
  const link = (fakes: FakePorts) => readScoringLink(fakes.kv, FIXTURE, HOST);

  it('forgets the link and the saved match: the pad shows its bad-link card, Home has nothing to continue', async () => {
    const fakes = await savedRig();
    fakes.scoring.revoke();
    scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect(await link(fakes)).toEqual({ kind: 'none' });
    expect(saved(fakes)).toBeUndefined();
    expect(fakes.kv.entries.has('code.scoring')).toBe(false);
  });

  it('keeps both while a tap is queued: the taps are the leftover Home shows, and the link is how a fresh scan finds them', async () => {
    const fakes = await savedRig();
    await queued(fakes, FIXTURE);
    fakes.scoring.revoke();
    scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect((await link(fakes)).kind).toBe('link');
    expect(saved(fakes)).toBeDefined();
  });

  it('keeps them while the link is alive', async () => {
    const fakes = await savedRig();
    scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect((await link(fakes)).kind).toBe('link');
    expect(saved(fakes)).toBeDefined();
  });

  it('keeps them when the match is over, not the link: a new link would not change that', async () => {
    const fakes = await savedRig();
    const read = await fakes.scoring.bootstrap(LINK);
    if (read.kind !== 'ok') throw new Error('the fake serves the match');
    vi.spyOn(fakes.scoring, 'bootstrap').mockResolvedValue({
      kind: 'ok',
      bootstrap: { ...read.bootstrap, status: 'finalized' },
    });
    scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect((await link(fakes)).kind).toBe('link');
    expect(saved(fakes)).toBeDefined();
  });

  it('forgets the code only if it is this match’s: another saved match is left alone', async () => {
    const fakes = await savedRig('fx-other');
    fakes.scoring.revoke();
    scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect(await link(fakes)).toEqual({ kind: 'none' });
    expect(saved(fakes)?.scoring?.fixtureId).toBe('fx-other');
  });

  it('a second focus of the dead match forgets nothing more and throws nothing', async () => {
    const fakes = await savedRig();
    fakes.scoring.revoke();
    const hub = scoringHubOf(fakes.ports);
    hub.focus(FIXTURE);
    await flush();
    const del = vi.spyOn(fakes.kv, 'delete');
    hub.focus(FIXTURE);
    await flush();
    expect(del).not.toHaveBeenCalled();
  });

  it('a store that refuses the forget is recorded, never thrown, and the pad goes on', async () => {
    const fakes = await savedRig();
    fakes.scoring.revoke();
    vi.spyOn(fakes.kv, 'delete').mockRejectedValue(new Error('keystore locked'));
    const { runner } = scoringHubOf(fakes.ports).focus(FIXTURE);
    await flush();
    expect(runner.snapshot().kind).toBe('ready');
    expect(readRecord(fakes.record)).toContainEqual(
      expect.objectContaining({ event: 'scoring.dead-link-forget-refused' }),
    );
  });
});
