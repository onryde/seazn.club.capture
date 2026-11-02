import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadmintonTap } from '@/domain/scoring/badmintonPad';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { createScoringRunner, type RunnerMode, type ScoringRunner } from '@/hooks/scoringRunner';
import { SINGLES_SEED } from '@/services/fakeScoringPort';
import { saveScoringLink } from '@/services/scoringLinkStore';
import { FAKE_SCORING_SECRET } from '../../test/fakeScoringLinkPort';
import { queuedOf, rally } from '../../test/badmintonLedger';
import { createFakePorts, readRecord, timerClock, type FakePorts } from '../../test/fakePorts';

// The effectful half of one match (plan S2-1 Task 9) over the real reducer, the real queue store on an in-memory folder
// and the fake server (which folds with the real engine). Every expectation is a literal: the singles match is not
// started, so its first tap is a start, then a rally by the first side; the server writes them as seq 1 and 2.

const FIXTURE = SINGLES_SEED.fixtureId;
const HOST = 'stg.seazn.club';
const LINK = { origin: 'https://stg.seazn.club', token: FAKE_SCORING_SECRET };
const AT = '2026-11-02T09:00:00.000Z';
const START: BadmintonTap = { kind: 'start', server: 'first' };
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

type Rig = {
  readonly fakes: FakePorts;
  readonly runner: ScoringRunner;
  readonly idle: ReturnType<typeof vi.fn>;
};

function newFakes(): FakePorts {
  return createFakePorts({ clock: timerClock });
}

async function rig(
  fakes: FakePorts,
  mode: RunnerMode = 'focused',
  options: { link?: boolean } = {},
): Promise<Rig> {
  if (options.link !== false) await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST);
  const idle = vi.fn();
  const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode, onIdle: idle });
  await runner.start();
  await flush();
  return { fakes, runner, idle };
}

const ledgerTypes = async (fakes: FakePorts): Promise<string[]> => {
  const events = await fakes.scoring.events(LINK, FIXTURE, 0);
  return Array.isArray(events) ? events.map((event) => event.type) : [];
};

const pendingKeys = (runner: ScoringRunner): string[] => {
  const snapshot = runner.snapshot();
  return snapshot.kind === 'ready' ? snapshot.state.sync.queue.pending.map((item) => item.key) : [];
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T09:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('opening a match', () => {
  it('with no link saved says so and reads nothing', async () => {
    const fakes = newFakes();
    const events = vi.spyOn(fakes.scoring, 'events');
    const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap');
    const { runner } = await rig(fakes, 'focused', { link: false });
    expect(runner.snapshot()).toEqual({ kind: 'noLink' });
    expect(events).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('with a secure store that does not answer says the link is unreadable, not gone', async () => {
    const fakes = newFakes();
    vi.spyOn(fakes.kv, 'get').mockRejectedValue(new Error('keystore locked'));
    const { runner } = await rig(fakes, 'focused', { link: false });
    expect(runner.snapshot()).toEqual({ kind: 'unreadable', what: 'link' });
  });

  it('keeps the link’s token out of the log before the first read goes out', async () => {
    const fakes = newFakes();
    const protect = vi.spyOn(fakes.ports.logger, 'protectLink');
    const events = vi.spyOn(fakes.scoring, 'events');
    await rig(fakes);
    expect(protect).toHaveBeenCalledWith(FAKE_SCORING_SECRET);
    expect(protect.mock.invocationCallOrder[0]).toBeLessThan(events.mock.invocationCallOrder[0]);
  });

  it('with a queue file that cannot be read says so, never an empty queue the next tap would overwrite', async () => {
    const fakes = newFakes();
    fakes.queueFiles.files.set(`${FIXTURE}.json`, '{ not json');
    const { runner } = await rig(fakes);
    expect(runner.snapshot()).toEqual({ kind: 'unreadable', what: 'queue' });
    expect(runner.dispatch(tap(START, 'k1'))).toBeNull();
  });

  it('with no queue file starts from an empty queue of its own: no taps, no own events, not dead', async () => {
    const { runner } = await rig(newFakes());
    const snapshot = runner.snapshot();
    expect(snapshot.kind === 'ready' ? snapshot.state.sync.queue : 'not ready').toEqual({
      fixtureId: FIXTURE,
      label: '',
      pending: [],
      ownEventIds: [],
      dead: null,
    });
  });

  it('with a queue store that throws instead of answering says the queue is unreadable, never nothing', async () => {
    const fakes = newFakes();
    vi.spyOn(fakes.tapQueue, 'load').mockRejectedValue(new Error('native module not found'));
    const { runner } = await rig(fakes);
    expect(runner.snapshot()).toEqual({ kind: 'unreadable', what: 'queue' });
    expect(runner.dispatch(tap(START, 'k1'))).toBeNull();
  });

  it('reads the bootstrap and the ledger from the server, and is ready', async () => {
    const { runner } = await rig(newFakes());
    const snapshot = runner.snapshot();
    expect(snapshot.kind).toBe('ready');
    if (snapshot.kind !== 'ready') return;
    expect(snapshot.state.bootstrap?.sportKey).toBe('badminton');
    expect(snapshot.state.sync.ledger).toEqual([]);
  });

  it('a second start does nothing: one set of subscriptions, one first read', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const events = vi.spyOn(fakes.scoring, 'events');
    await runner.start();
    await flush();
    expect(events).not.toHaveBeenCalled();
    expect(fakes.foreground.returnListeners()).toBe(1);
  });

  it('opens from what the disk holds: the saved queue is the state, its tap kept for sending', async () => {
    const fakes = newFakes();
    const first = await rig(fakes);
    fakes.scoring.goOffline(true);
    first.runner.dispatch(tap(START, 'k1'));
    await flush();
    await first.runner.stop();
    const again = await rig(fakes);
    expect(pendingKeys(again.runner)).toEqual(['k1']);
  });

  it('the reopened tap goes once the network is back, from a focused runner: one send of it, under its key', async () => {
    const fakes = newFakes();
    const first = await rig(fakes);
    fakes.scoring.goOffline(true);
    first.runner.dispatch(tap(START, 'k1'));
    await flush();
    await first.runner.stop();
    const real = fakes.scoring.append;
    const bodies: string[] = [];
    vi.spyOn(fakes.scoring, 'append').mockImplementation(async (link, fixtureId, body) => {
      bodies.push(body.idempotency_key);
      return real(link, fixtureId, body);
    });
    const again = await rig(fakes, 'focused');
    fakes.scoring.goOffline(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bodies).toEqual(['k1']);
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
    expect(pendingKeys(again.runner)).toEqual([]);
  });
});

describe('the link a build reads', () => {
  it('is the one kept for its own host, whichever it is: a production build reads a production link', async () => {
    const fakes = createFakePorts({ clock: timerClock, hosts: ['seazn.club'] });
    await saveScoringLink(
      fakes.kv,
      FIXTURE,
      { origin: 'https://seazn.club', token: FAKE_SCORING_SECRET },
      'seazn.club',
    );
    const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'focused' });
    await runner.start();
    await flush();
    expect(runner.snapshot().kind).toBe('ready');
    expect(runner.link()).toEqual({ origin: 'https://seazn.club', token: FAKE_SCORING_SECRET });
  });

  it('is none for a link kept for another host: a production build never sends a staging token', async () => {
    const fakes = createFakePorts({ clock: timerClock, hosts: ['seazn.club'] });
    await saveScoringLink(fakes.kv, FIXTURE, LINK, 'stg.seazn.club');
    const events = vi.spyOn(fakes.scoring, 'events');
    const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'focused' });
    await runner.start();
    await flush();
    expect(runner.snapshot()).toEqual({ kind: 'noLink' });
    expect(events).not.toHaveBeenCalled();
  });
});

describe('taps queued on a match with no link to send them on', () => {
  const holding = (over: { dead?: 'finalized' | 'LINK_REVOKED' | null; taps?: number } = {}) => ({
    fixtureId: FIXTURE,
    label: 'Match 4',
    pending: Array.from({ length: over.taps ?? 2 }, (_, i) => queuedOf(`k${i}`, rally('H'))),
    ownEventIds: [],
    dead: over.dead ?? null,
  });

  it.each<RunnerMode>(['focused', 'headless'])(
    'a %s runner marks the queue dead on its link, so nobody waits for taps that cannot go',
    async (mode) => {
      const fakes = newFakes();
      await fakes.tapQueue.save(holding());
      await rig(fakes, mode, { link: false });
      const marked = await fakes.tapQueue.load(FIXTURE);
      expect(marked?.dead).toBe('LINK_INVALID');
      expect(marked?.pending).toHaveLength(2);
      expect(marked?.label).toBe('Match 4');
    },
  );

  it('leaves a queue with nothing in it as it was', async () => {
    const fakes = newFakes();
    await fakes.tapQueue.save(holding({ taps: 0 }));
    await rig(fakes, 'focused', { link: false });
    expect((await fakes.tapQueue.load(FIXTURE))?.dead).toBeNull();
  });

  it('leaves a match with no queue file with none', async () => {
    const fakes = newFakes();
    await rig(fakes, 'focused', { link: false });
    expect(await fakes.tapQueue.load(FIXTURE)).toBeNull();
    // Nothing to mark is not a refused mark: a missing guard would throw into the catch and leave this line instead.
    expect(readRecord(fakes.record).map((line) => line.event)).not.toContain(
      'scoring.no-link-mark-refused',
    );
  });

  it('keeps the word a queue already died of', async () => {
    const fakes = newFakes();
    await fakes.tapQueue.save(holding({ dead: 'finalized' }));
    await rig(fakes, 'focused', { link: false });
    expect((await fakes.tapQueue.load(FIXTURE))?.dead).toBe('finalized');
  });

  it('marks nothing when the secure store does not answer: that says nothing of the link', async () => {
    const fakes = newFakes();
    await fakes.tapQueue.save(holding());
    vi.spyOn(fakes.kv, 'get').mockRejectedValue(new Error('keystore locked'));
    await rig(fakes, 'focused', { link: false });
    expect((await fakes.tapQueue.load(FIXTURE))?.dead).toBeNull();
  });

  it('a mark the disk refuses is recorded and never raised', async () => {
    const fakes = newFakes();
    await fakes.tapQueue.save(holding());
    vi.spyOn(fakes.tapQueue, 'save').mockRejectedValue(new Error('disk full'));
    const { runner } = await rig(fakes, 'focused', { link: false });
    expect(runner.snapshot()).toEqual({ kind: 'noLink' });
    expect(readRecord(fakes.record).map((line) => line.event)).toContain(
      'scoring.no-link-mark-refused',
    );
  });
});

describe('a tap', () => {
  it('is shown only once it is durable, and not before', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = fakes.tapQueue.save;
    vi.spyOn(fakes.tapQueue, 'save').mockImplementation(async (queue) => {
      await gate;
      return real(queue);
    });
    const heard = vi.fn();
    runner.subscribe(heard);
    expect(runner.dispatch(tap(START, 'k1'))).toEqual({ ok: true });
    await flush();
    expect(pendingKeys(runner)).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
    open();
    await flush();
    expect(heard).toHaveBeenCalled();
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });

  it('is saved before it is sent, and the save that marks the attempt is saved before the call', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const onDisk: Array<string | undefined> = [];
    const real = fakes.scoring.append;
    vi.spyOn(fakes.scoring, 'append').mockImplementation(async (link, fixtureId, body) => {
      onDisk.push(fakes.queueFiles.files.get(`${FIXTURE}.json`));
      return real(link, fixtureId, body);
    });
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]).toContain('"key":"k1"');
    expect(onDisk[0]).toContain('"attempts":1');
  });

  it('whose save is refused is not sent, says so, and the next tap saves and goes', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const append = vi.spyOn(fakes.scoring, 'append');
    vi.spyOn(fakes.tapQueue, 'save').mockRejectedValueOnce(new Error('the disk refused'));
    runner.dispatch(tap(START, 'k1'));
    await flush();
    const failed = runner.snapshot();
    expect(failed.kind === 'ready' ? failed.state.line : 'not ready').toEqual({
      kind: 'refusal',
      key: 'scoring.refusal.notSaved',
    });
    expect(append).not.toHaveBeenCalled();
    expect(pendingKeys(runner)).toEqual([]);
    runner.dispatch(tap(START, 'k2'));
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });

  it('is sent in order, one at a time, and the queue and the cached ledger follow the server', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    runner.dispatch(tap(START, 'k1'));
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
    expect(pendingKeys(runner)).toEqual([]);
    const cached = await fakes.tapQueue.loadLedger(FIXTURE);
    expect(cached?.map((event) => event.seq)).toEqual([1, 2]);
  });

  it('offline stays queued, in order, and goes when the network is back', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    fakes.scoring.goOffline(true);
    runner.dispatch(tap(START, 'k1'));
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    expect(pendingKeys(runner)).toEqual(['k1', 'k2']);
    expect(await ledgerTypes(fakes)).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pendingKeys(runner)).toEqual(['k1', 'k2']);
    fakes.scoring.goOffline(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
    expect(pendingKeys(runner)).toEqual([]);
  });

  it('while the app is in the background is saved and kept, and goes on the return', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const append = vi.spyOn(fakes.scoring, 'append');
    fakes.foreground.leave();
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(append).not.toHaveBeenCalled();
    expect(fakes.queueFiles.files.get(`${FIXTURE}.json`)).toContain('"key":"k1"');
    fakes.foreground.fire();
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
    expect(pendingKeys(runner)).toEqual([]);
  });

  it('a send already out when the app leaves has its answer taken, and the tap behind it waits for the return', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    let answer: () => void = () => undefined;
    const real = fakes.scoring.append;
    const bodies: string[] = [];
    vi.spyOn(fakes.scoring, 'append').mockImplementation(async (link, fixtureId, body) => {
      bodies.push(body.idempotency_key);
      await new Promise<void>((resolve) => (answer = resolve));
      return real(link, fixtureId, body);
    });
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(bodies).toEqual(['k1']);
    fakes.foreground.leave();
    runner.dispatch(tap(RALLY, 'k2'));
    answer();
    await flush();
    expect(pendingKeys(runner)).toEqual(['k2']);
    expect(bodies).toEqual(['k1']);
    fakes.foreground.fire();
    await flush();
    answer();
    await flush();
    expect(bodies).toEqual(['k1', 'k2']);
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
    expect(pendingKeys(runner)).toEqual([]);
  });
});

describe('the saves of one match', () => {
  it('land in the order they were asked for: a second tap’s save does not start before the first has landed', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    fakes.scoring.goOffline(true);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = fakes.tapQueue.save;
    const started: string[][] = [];
    vi.spyOn(fakes.tapQueue, 'save').mockImplementation(async (queue) => {
      started.push(queue.pending.map((item) => item.key));
      if (started.length === 1) await gate;
      return real(queue);
    });
    runner.dispatch(tap(START, 'k1'));
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    expect(started).toEqual([['k1']]);
    open();
    await flush();
    expect(started.slice(0, 2)).toEqual([['k1'], ['k1', 'k2']]);
    expect(fakes.queueFiles.files.get(`${FIXTURE}.json`)).toContain('"key":"k2"');
  });
});

describe('a send that waits for its attempt’s save', () => {
  /** The first save (the tap) lands; the second (the attempt counted) waits for `open()`. Optionally it is refused. */
  function holdAttempt(fakes: FakePorts, refuse = false) {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = fakes.tapQueue.save;
    let calls = 0;
    vi.spyOn(fakes.tapQueue, 'save').mockImplementation(async (queue) => {
      calls += 1;
      if (calls !== 2) return real(queue);
      await gate;
      if (refuse) throw new Error('the disk refused');
      return real(queue);
    });
    return open;
  }

  it('is not made once the runner has been stopped meanwhile', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const append = vi.spyOn(fakes.scoring, 'append');
    const open = holdAttempt(fakes);
    runner.dispatch(tap(START, 'k1'));
    await flush();
    const stopping = runner.stop();
    open();
    await stopping;
    await flush();
    expect(append).not.toHaveBeenCalled();
  });

  it('is not made once the app has gone to the background meanwhile, and is on the return', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const append = vi.spyOn(fakes.scoring, 'append');
    const open = holdAttempt(fakes);
    runner.dispatch(tap(START, 'k1'));
    await flush();
    fakes.foreground.leave();
    open();
    await flush();
    expect(append).not.toHaveBeenCalled();
    fakes.foreground.fire();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(append).toHaveBeenCalledTimes(1);
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });

  it('is not made when that save is refused, and is asked again later under the same key', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const append = vi.spyOn(fakes.scoring, 'append');
    const open = holdAttempt(fakes, true);
    runner.dispatch(tap(START, 'k1'));
    await flush();
    open();
    await flush();
    expect(append).not.toHaveBeenCalled();
    expect(pendingKeys(runner)).toEqual(['k1']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][2].idempotency_key).toBe('k1');
    expect(pendingKeys(runner)).toEqual([]);
  });

  it('a wait for the sender is not pushed back by a longer wait asked for later', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    fakes.scoring.goOffline(true);
    const append = vi.spyOn(fakes.scoring, 'append');
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(append).toHaveBeenCalledTimes(1);
    // k2's save is refused, and so is the save that takes it back out: the second refusal asks for a 5 s wait.
    vi.spyOn(fakes.tapQueue, 'save')
      .mockRejectedValueOnce(new Error('the disk refused'))
      .mockRejectedValueOnce(new Error('the disk refused'));
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(append).toHaveBeenCalledTimes(2);
  });
});

describe('the waits', () => {
  it('each gets its timer: a 5 s re-save fires and its line shows, and the 15 s send asked for before it still goes', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const others = vi.getTimerCount();
    const real = fakes.scoring.append;
    const append = vi
      .spyOn(fakes.scoring, 'append')
      .mockResolvedValueOnce({ kind: 'rateLimited', retryAfterMs: 15_000 });
    append.mockImplementation(real);
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(append).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(others + 1);
    // k2's save is refused, and so is the save that takes it back out: that one asks for a 5 s wait.
    vi.spyOn(fakes.tapQueue, 'save')
      .mockRejectedValueOnce(new Error('the disk refused'))
      .mockRejectedValueOnce(new Error('the disk refused'));
    runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    const lineAt = () => {
      const snapshot = runner.snapshot();
      return snapshot.kind === 'ready' ? snapshot.state.line : 'not ready';
    };
    expect(lineAt()).toEqual({ kind: 'refusal', key: 'scoring.refusal.savePending' });
    // The earlier wait took the timer: the 15 s one is not left running beside it.
    expect(vi.getTimerCount()).toBe(others + 1);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(lineAt()).toEqual({ kind: 'refusal', key: 'scoring.refusal.notSaved' });
    expect(append).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(append).toHaveBeenCalledTimes(2);
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
    expect(pendingKeys(runner)).toEqual([]);
  });

  it('a rules read that failed is asked again after 15 s, and the send waits for it', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const realAppend = fakes.scoring.append;
    const append = vi
      .spyOn(fakes.scoring, 'append')
      .mockResolvedValueOnce({ kind: 'rulesChanged', rulesVersion: 1 });
    append.mockImplementation(realAppend);
    const realRules = fakes.scoring.rules;
    const rules = vi.spyOn(fakes.scoring, 'rules').mockResolvedValueOnce({ kind: 'offline' });
    rules.mockImplementation(realRules);
    rules.mockResolvedValueOnce({ kind: 'offline' });
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(rules).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14_900);
    expect(rules).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(rules).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(append).toHaveBeenCalledTimes(2);
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
  });

  it('stopping clears the timer: nothing wakes a stopped runner', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const baseline = vi.getTimerCount();
    fakes.scoring.goOffline(true);
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(baseline);
    await runner.stop();
    expect(vi.getTimerCount()).toBe(baseline);
  });
});

describe('an Undo asked while its tap’s answer is lost', () => {
  const UNDO: MatchEvent = { kind: 'undo', key: 'u1', at: AT };

  /** The match started; a rally written by the server whose answer never came back; the Undo asked while it waits. */
  async function askedMidWait(fakes: FakePorts) {
    const first = await rig(fakes);
    first.runner.dispatch(tap(START, 'k1'));
    await flush();
    fakes.scoring.dropNextAnswer();
    first.runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    first.runner.dispatch(UNDO);
    await flush();
    return first;
  }

  it('is saved with the queue: both stay pending, the Undo names its tap, and nothing is sent for it yet', async () => {
    const fakes = newFakes();
    const { runner } = await askedMidWait(fakes);
    expect(pendingKeys(runner)).toEqual(['k2', 'u1']);
    expect(fakes.queueFiles.files.get(`${FIXTURE}.json`)).toContain('"voidsKey":"k2"');
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
  });

  it('survives a kill: the reopened runner sends the tap again under its key, then the void of what the answer names, once', async () => {
    const fakes = newFakes();
    const { runner } = await askedMidWait(fakes);
    await runner.stop();
    const real = fakes.scoring.append;
    const bodies: string[] = [];
    vi.spyOn(fakes.scoring, 'append').mockImplementation(async (link, fixtureId, body) => {
      bodies.push(body.idempotency_key);
      return real(link, fixtureId, body);
    });
    const again = await rig(fakes);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bodies).toEqual(['k2', 'u1']);
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally', 'core.void']);
    expect(pendingKeys(again.runner)).toEqual([]);
  });

  it('is sent once the tap is answered, and the pad goes on showing it taken back', async () => {
    const fakes = newFakes();
    const { runner } = await askedMidWait(fakes);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally', 'core.void']);
    expect(pendingKeys(runner)).toEqual([]);
  });
});

describe('a call that throws instead of answering', () => {
  it('a ledger read that throws is a failed read: the next ping reads again, none is left in flight', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const events = vi
      .spyOn(fakes.scoring, 'events')
      .mockRejectedValueOnce(new Error('the native module fell over'));
    runner.dispatch({ kind: 'read' });
    await flush();
    expect(events).toHaveBeenCalledTimes(1);
    runner.dispatch({ kind: 'read' });
    await flush();
    expect(events).toHaveBeenCalledTimes(2);
  });

  it('a send whose call throws leaves the tap queued: it is asked again after the wait, under its own key', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const append = vi
      .spyOn(fakes.scoring, 'append')
      .mockRejectedValueOnce(new Error('the native module fell over'));
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(pendingKeys(runner)).toEqual(['k1']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls.map((call) => call[2].idempotency_key)).toEqual(['k1', 'k1']);
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
    expect(pendingKeys(runner)).toEqual([]);
  });

  it('a bootstrap read that throws is a failed read: the next ask reads again', async () => {
    const fakes = newFakes();
    const real = fakes.scoring.bootstrap;
    const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap').mockImplementation(async (link) => {
      const read = await real(link);
      return read.kind === 'ok'
        ? { kind: 'ok', bootstrap: { ...read.bootstrap, screen: 'divisionNotStarted' } }
        : read;
    });
    bootstrap.mockRejectedValueOnce(new Error('the native module fell over'));
    const { runner } = await rig(fakes);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    runner.dispatch({ kind: 'read' });
    await flush();
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('a rules read that throws is a failed read: it is asked again 15 s later', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const realAppend = fakes.scoring.append;
    vi.spyOn(fakes.scoring, 'append')
      .mockResolvedValueOnce({ kind: 'rulesChanged', rulesVersion: 1 })
      .mockImplementation(realAppend);
    const rules = vi
      .spyOn(fakes.scoring, 'rules')
      .mockRejectedValueOnce(new Error('the native module fell over'));
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(rules).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(rules).toHaveBeenCalledTimes(2);
  });
});

describe('a read asked for again while one is out', () => {
  it('a bootstrap read is one in flight and one more after it, not one each', async () => {
    const fakes = newFakes();
    const real = fakes.scoring.bootstrap;
    let release: () => void = () => undefined;
    const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap').mockImplementation(async (link) => {
      await new Promise<void>((resolve) => (release = resolve));
      const read = await real(link);
      return read.kind === 'ok'
        ? { kind: 'ok', bootstrap: { ...read.bootstrap, screen: 'divisionNotStarted' } }
        : read;
    });
    const { runner } = await rig(fakes);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i += 1) runner.dispatch({ kind: 'read' });
    await flush();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(bootstrap).toHaveBeenCalledTimes(2);
    release();
    await flush();
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('a stopped runner reads no more: a ledger read in flight when it stops asks for no second one', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    let release: () => void = () => undefined;
    const real = fakes.scoring.events;
    const events = vi.spyOn(fakes.scoring, 'events').mockImplementation(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return real(...args);
    });
    for (let i = 0; i < 3; i += 1) runner.dispatch({ kind: 'read' });
    await flush();
    expect(events).toHaveBeenCalledTimes(1);
    await runner.stop();
    release();
    await flush();
    expect(events).toHaveBeenCalledTimes(1);
  });
});

describe('reading the ledger', () => {
  it('a burst of pings is one read in flight and one more after it, not one each', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    let release: () => void = () => undefined;
    const real = fakes.scoring.events;
    const events = vi.spyOn(fakes.scoring, 'events').mockImplementation(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return real(...args);
    });
    for (let i = 0; i < 5; i += 1) runner.dispatch({ kind: 'read' });
    await flush();
    expect(events).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(events).toHaveBeenCalledTimes(2);
    release();
    await flush();
    expect(events).toHaveBeenCalledTimes(2);
  });

  it('another scorer’s tap is brought in and shown', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    runner.dispatch(tap(START, 'k1'));
    await flush();
    const events = vi.spyOn(fakes.scoring, 'events');
    fakes.scoring.addOtherScorerEvent('badminton.rally', {
      wonBy: SINGLES_SEED.sides.home.entrantId,
    });
    runner.dispatch({ kind: 'read' });
    await flush();
    expect(events).toHaveBeenCalledWith(LINK, FIXTURE, 1);
    const snapshot = runner.snapshot();
    expect(
      snapshot.kind === 'ready' ? snapshot.state.sync.ledger.map((event) => event.seq) : [],
    ).toEqual([1, 2]);
  });
});

describe('caches', () => {
  it('a ledger or a boot cache that cannot be written never stops a tap', async () => {
    const fakes = newFakes();
    vi.spyOn(fakes.tapQueue, 'saveLedger').mockRejectedValue(new Error('disk full'));
    vi.spyOn(fakes.tapQueue, 'saveBoot').mockRejectedValue(new Error('disk full'));
    const { runner } = await rig(fakes);
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(await ledgerTypes(fakes)).toEqual(['core.start']);
    expect(pendingKeys(runner)).toEqual([]);
  });

  it('the bootstrap and the Start screen’s pick are kept for a reopen with no signal', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    runner.dispatch({ kind: 'pickServer', side: 'second' });
    await flush();
    const boot = await fakes.tapQueue.loadBoot(FIXTURE);
    expect(boot?.toss).toBe('second');
    expect(boot?.bootstrap.sportKey).toBe('badminton');
  });
});

describe('stopping', () => {
  it('waits for the saves already made, then sends nothing and hears nothing', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const append = vi.spyOn(fakes.scoring, 'append');
    runner.dispatch(tap(START, 'k1'));
    await runner.stop();
    await flush();
    expect(append).not.toHaveBeenCalled();
    expect(fakes.queueFiles.files.get(`${FIXTURE}.json`)).toContain('"key":"k1"');
    expect(runner.dispatch(tap(RALLY, 'k2'))).toBeNull();
    expect(fakes.foreground.returnListeners()).toBe(0);
    expect(fakes.foreground.leaveListeners()).toBe(0);
  });

  it('does not finish while a save is still being made, and finishes when it lands', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const real = fakes.tapQueue.save;
    vi.spyOn(fakes.tapQueue, 'save').mockImplementation(async (queue) => {
      await gate;
      return real(queue);
    });
    runner.dispatch(tap(START, 'k1'));
    await flush();
    const stopped = vi.fn();
    const stopping = runner.stop().then(stopped);
    await flush();
    expect(stopped).not.toHaveBeenCalled();
    open();
    await stopping;
    expect(stopped).toHaveBeenCalled();
    expect(fakes.queueFiles.files.get(`${FIXTURE}.json`)).toContain('"key":"k1"');
  });

  it('does not finish while a send is out, and finishes once its call has come back', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    let answer: () => void = () => undefined;
    const real = fakes.scoring.append;
    vi.spyOn(fakes.scoring, 'append').mockImplementation(async (link, fixtureId, body) => {
      await new Promise<void>((resolve) => (answer = resolve));
      return real(link, fixtureId, body);
    });
    runner.dispatch(tap(START, 'k1'));
    await flush();
    const stopped = vi.fn();
    const stopping = runner.stop().then(stopped);
    await flush();
    expect(stopped).not.toHaveBeenCalled();
    answer();
    await stopping;
    expect(stopped).toHaveBeenCalled();
  });

  it('clears its timer: an offline tap waiting to be asked again is not asked after the stop', async () => {
    const fakes = newFakes();
    const { runner } = await rig(fakes);
    const others = vi.getTimerCount();
    fakes.scoring.goOffline(true);
    runner.dispatch(tap(START, 'k1'));
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(others);
    await runner.stop();
    expect(vi.getTimerCount()).toBe(others);
  });

  it('before the first read finished leaves nothing subscribed', async () => {
    const fakes = newFakes();
    await saveScoringLink(fakes.kv, FIXTURE, LINK, HOST);
    const runner = createScoringRunner(fakes.ports, { fixtureId: FIXTURE, mode: 'focused' });
    const starting = runner.start();
    await runner.stop();
    await starting;
    await flush();
    expect(fakes.foreground.returnListeners()).toBe(0);
    expect(runner.snapshot()).toEqual({ kind: 'loading' });
  });

  it('a listener that left is not told again', async () => {
    const { runner } = await rig(newFakes());
    const heard = vi.fn();
    const leave = runner.subscribe(heard);
    leave();
    runner.dispatch({ kind: 'pickServer', side: 'first' });
    await flush();
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('a headless sender (a match nobody is looking at)', () => {
  /** Two taps queued offline by a focused runner that then leaves, as a scorer leaves a match with taps unsent. */
  async function leftQueued(fakes: FakePorts): Promise<void> {
    const first = await rig(fakes);
    fakes.scoring.goOffline(true);
    first.runner.dispatch(tap(START, 'k1'));
    first.runner.dispatch(tap(RALLY, 'k2'));
    await flush();
    await first.runner.stop();
    fakes.scoring.goOffline(false);
  }

  it('sends the saved taps in order without the bootstrap, then says it is idle exactly once', async () => {
    const fakes = newFakes();
    await leftQueued(fakes);
    const bootstrap = vi.spyOn(fakes.scoring, 'bootstrap');
    const loadBoot = vi.spyOn(fakes.tapQueue, 'loadBoot');
    const { runner, idle } = await rig(fakes, 'headless');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await ledgerTypes(fakes)).toEqual(['core.start', 'badminton.rally']);
    expect(pendingKeys(runner)).toEqual([]);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(loadBoot).not.toHaveBeenCalled();
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('with nothing queued is idle at once', async () => {
    const { idle } = await rig(newFakes(), 'headless');
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('a queue whose link is dead is idle: it can send no more', async () => {
    const fakes = newFakes();
    await leftQueued(fakes);
    fakes.scoring.revoke();
    const { runner, idle } = await rig(fakes, 'headless');
    await vi.advanceTimersByTimeAsync(60_000);
    const snapshot = runner.snapshot();
    expect(snapshot.kind === 'ready' ? snapshot.state.sync.queue.dead : 'not ready').toBe(
      'LINK_REVOKED',
    );
    expect(pendingKeys(runner)).toEqual(['k1', 'k2']);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('a focused runner is never idle by itself: the screen owns it', async () => {
    const { idle } = await rig(newFakes());
    expect(idle).not.toHaveBeenCalled();
  });
});
