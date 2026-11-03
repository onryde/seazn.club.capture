import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scoringHubOf } from '@/hooks/scoringHub';
import { SCORING_POLL_MS, useContinueScoring, useScoringRows } from '@/hooks/useScoringHome';
import { createFakePorts, readRecord } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';
import { DECIDED_MATCH, GAME_ONE_21_15 } from '../../test/badmintonLedger';
import {
  FAKE_MATCH,
  STORED_LINK,
  leave,
  leaveHistory,
  linkKey,
  queueHolding,
} from '../../test/scoringHomeFixtures';
import { createTapQueueStore } from '@/services/tapQueueStore';

// The hooks under Home's Remote Scoring cards (plan S2-1 Task 10), on their own: what the screen tests cannot see.

describe('useScoringRows', () => {
  it('hands out the same rows while the disk reads the same, so Home does not render for nothing', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding('fx-old', 2, { label: 'Match 7' }));
    const hook = renderHook(() => useScoringRows(), { wrapper: wrapperFor(fakes) });
    await act(async () => undefined);
    const first = hook.result.current.rows;
    expect(first).toHaveLength(1);
    act(() => hook.result.current.refresh());
    await act(async () => undefined);
    expect(hook.result.current.rows).toBe(first);
  });

  it('hands out new rows when a count moves', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding('fx-old', 2, { label: 'Match 7' }));
    const hook = renderHook(() => useScoringRows(), { wrapper: wrapperFor(fakes) });
    await act(async () => undefined);
    const first = hook.result.current.rows;
    await leave(fakes, queueHolding('fx-old', 1, { label: 'Match 7' }));
    act(() => hook.result.current.refresh());
    await act(async () => undefined);
    expect(hook.result.current.rows).not.toBe(first);
    const [row] = hook.result.current.rows;
    expect(row?.kind === 'queue' ? row.queue.pending.length : -1).toBe(1);
  });
});

// A queue held for the scorer's answer to the reconnect question sends nothing (round 4, item 6): Home does not poll the
// disk for it, since nothing on the disk will move until the scorer opens the pad and answers.
describe('useScoringRows, polling', () => {
  afterEach(() => vi.useRealTimers());
  const polled = async (...queues: ReturnType<typeof queueHolding>[]) => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    for (const queue of queues) await leave(fakes, queue);
    renderHook(() => useScoringRows(), { wrapper: wrapperFor(fakes) });
    await act(() => vi.advanceTimersByTimeAsync(10));
    const listed = vi.spyOn(fakes.ports.tapQueue, 'list');
    await act(() => vi.advanceTimersByTimeAsync(3 * SCORING_POLL_MS));
    return listed.mock.calls.length;
  };

  it('polls while a queue is sending', async () => {
    expect(await polled(queueHolding('fx-a', 2))).toBe(3);
  });

  it('does not poll for a queue held for the scorer’s answer', async () => {
    expect(await polled(queueHolding('fx-a', 2, { askedAbout: ['ev-9'] }))).toBe(0);
  });

  it('polls when one queue is held and another is sending: the sending one moves', async () => {
    expect(
      await polled(queueHolding('fx-a', 2, { askedAbout: ['ev-9'] }), queueHolding('fx-b', 1)),
    ).toBe(3);
  });

  it('does not poll for a queue that can never send, held or not', async () => {
    expect(
      await polled(queueHolding('fx-a', 2, { dead: 'LINK_REVOKED', askedAbout: ['ev-9'] })),
    ).toBe(0);
  });
});

// Home's Finished card (owner ruling 41, 2026-11-02): the saved match is read from the phone's files for the one
// question the queue list cannot answer, whether it is over. Asked only when nothing of it is unsent.
describe('useScoringRows, whether the saved match is over', () => {
  const OVER = { fixtureId: FAKE_MATCH, score: '21–15, 21–18' };

  async function decidedOnDisk(taps = 0) {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, taps));
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    return fakes;
  }
  /** Every scoring link the secure store was asked for: the match's files are read through it first. */
  const linkReads = (read: { mock: { calls: unknown[][] } }): unknown[] =>
    read.mock.calls.map(([key]) => key).filter((key) => String(key).startsWith('scoring.link.'));
  const rowsFor = (fakes: ReturnType<typeof createFakePorts>, saved: string | null = FAKE_MATCH) =>
    renderHook(({ id }: { id: string | null }) => useScoringRows(id), {
      wrapper: wrapperFor(fakes),
      initialProps: { id: saved },
    });

  it('finds the saved match over when its files say so and nothing is unsent', async () => {
    const fakes = await decidedOnDisk();
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('finds it over with no queue file at all', async () => {
    const fakes = createFakePorts();
    await fakes.kv.set(linkKey(FAKE_MATCH), STORED_LINK);
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('does not look while a tap is unsent: the match’s files are not even read', async () => {
    const fakes = await decidedOnDisk(2);
    const read = vi.spyOn(fakes.ports.kv, 'get');
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toBeNull();
    expect(linkReads(read)).toEqual([]);
  });

  it('does not look when no match is saved', async () => {
    const fakes = await decidedOnDisk();
    const read = vi.spyOn(fakes.ports.kv, 'get');
    const hook = rowsFor(fakes, null);
    await act(async () => undefined);
    expect(hook.result.current.finish).toBeNull();
    expect(linkReads(read)).toEqual([]);
  });

  it('does not look when the saved match’s queue file cannot be read', async () => {
    const fakes = await decidedOnDisk();
    fakes.queueFiles.files.set(`${FAKE_MATCH}.json`, '{ not json');
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.rows).toEqual([{ kind: 'unreadable', fixtureId: FAKE_MATCH }]);
    expect(hook.result.current.finish).toBeNull();
  });

  it('is not over for a match still in play', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15);
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toBeNull();
  });

  it('is over once the last unsent tap has gone, and the card was not before', async () => {
    const fakes = await decidedOnDisk(2);
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toBeNull();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    act(() => hook.result.current.refresh());
    await act(async () => undefined);
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('is still over when the app is killed and reopened: the files alone say so', async () => {
    const first = await decidedOnDisk();
    const reopened = createFakePorts({
      tapQueue: createTapQueueStore({ files: first.queueFiles, logger: first.ports.logger }),
      kvSeed: Object.fromEntries(first.kv.entries),
    });
    const hook = rowsFor(reopened);
    await act(async () => undefined);
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('says the new score when only the score has moved: same match, same queue, the server finalized it later', async () => {
    const fakes = await decidedOnDisk();
    await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15, { status: 'finalized' });
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toEqual({ fixtureId: FAKE_MATCH, score: '21–15' });
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH, { status: 'finalized' });
    act(() => hook.result.current.refresh());
    await act(async () => undefined);
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('keeps the same answer, to the identity, while the files read the same', async () => {
    const fakes = await decidedOnDisk();
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    const first = hook.result.current.finish;
    act(() => hook.result.current.refresh());
    await act(async () => undefined);
    expect(hook.result.current.finish).toBe(first);
  });

  it('reads again for the next saved match, and the old one’s answer is not its answer', async () => {
    const fakes = await decidedOnDisk();
    await leave(fakes, queueHolding('fx-next', 0));
    await leaveHistory(fakes, 'fx-next', GAME_ONE_21_15);
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toEqual(OVER);
    hook.rerender({ id: 'fx-next' });
    await act(async () => undefined);
    expect(hook.result.current.finish).toBeNull();
  });

  it('says so in the record and keeps the cards when the read of the match throws', async () => {
    const fakes = await decidedOnDisk();
    vi.spyOn(fakes.ports.tapQueue, 'loadLedger').mockRejectedValue(new Error('boom'));
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toBeNull();
    expect(hook.result.current.rows).toHaveLength(1);
    expect(readRecord(fakes.record).map((line) => line.event)).toContain(
      'scoring.home-finish-refused',
    );
  });

  it('lets the newest read win: a slow one begun earlier never puts back what a later one took away', async () => {
    const fakes = await decidedOnDisk();
    const list = fakes.ports.tapQueue.list.bind(fakes.ports.tapQueue);
    const gates: Array<() => void> = [];
    const spy = vi.spyOn(fakes.ports.tapQueue, 'list');
    // The first list (the mount's) waits for its gate; every later one goes straight through.
    spy.mockImplementationOnce(async () => {
      const rows = await list();
      await new Promise<void>((open) => gates.push(open));
      return rows;
    });
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toBeNull();
    await leave(fakes, queueHolding(FAKE_MATCH, 2));
    act(() => hook.result.current.refresh());
    await act(async () => undefined);
    expect(hook.result.current.rows).toHaveLength(1);
    expect(hook.result.current.finish).toBeNull();
    gates.forEach((open) => open());
    await act(async () => undefined);
    // The slow read saw an empty queue and a decided match; the newer one saw two taps unsent, and stands.
    expect(hook.result.current.finish).toBeNull();
    const [row] = hook.result.current.rows;
    expect(row?.kind === 'queue' ? row.queue.pending.length : -1).toBe(2);
  });
});

// Minor review items on ruling 41's card: the poll tick refreshes the list only (the saved match's files are read on
// mount, on a return to the foreground and when the saved match changes), except on the tick that sees its last unsent
// tap gone; and a decision made just before leaving the pad is read once the runner that was saving it has stopped.
describe('useScoringRows, when it reads the saved match', () => {
  const OVER = { fixtureId: FAKE_MATCH, score: '21–15, 21–18' };
  const linkReads = (read: { mock: { calls: unknown[][] } }): unknown[] =>
    read.mock.calls.map(([key]) => key).filter((key) => String(key).startsWith('scoring.link.'));
  const rowsFor = (fakes: ReturnType<typeof createFakePorts>) =>
    renderHook(() => useScoringRows(FAKE_MATCH), { wrapper: wrapperFor(fakes) });

  afterEach(() => vi.useRealTimers());

  it('reads the list on every tick and the saved match’s files on none: a decided match stays over', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    // Another match is sending, so Home polls.
    await leave(fakes, queueHolding('fx-other', 2));
    const read = vi.spyOn(fakes.ports.kv, 'get');
    const hook = rowsFor(fakes);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.finish).toEqual(OVER);
    const atMount = linkReads(read).length;
    expect(atMount).toBeGreaterThan(0);
    const listed = vi.spyOn(fakes.ports.tapQueue, 'list');
    await act(() => vi.advanceTimersByTimeAsync(3 * SCORING_POLL_MS));
    expect(listed).toHaveBeenCalledTimes(3);
    expect(linkReads(read)).toHaveLength(atMount);
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('reads them on the tick that sees the last unsent tap gone, and on no tick after it', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 2));
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    const hook = rowsFor(fakes);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.finish).toBeNull();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await act(() => vi.advanceTimersByTimeAsync(SCORING_POLL_MS));
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('reads them again once a runner that was saving the match has stopped: a decision just before the pad was left', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15);
    let stopped: () => void = () => undefined;
    const stopping = new Promise<void>((resolve) => (stopped = resolve));
    vi.spyOn(scoringHubOf(fakes.ports), 'settled').mockReturnValue(stopping);
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    // Home first looked while the runner's last writes were still out: the match reads as in play.
    expect(hook.result.current.finish).toBeNull();
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    await act(async () => undefined);
    expect(hook.result.current.finish).toBeNull();
    await act(async () => stopped());
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('a tick that lands while a full read is still in flight does not discard that read: Finished shows', async () => {
    vi.useFakeTimers();
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await leaveHistory(fakes, FAKE_MATCH, GAME_ONE_21_15);
    // Another match is sending, so Home polls.
    await leave(fakes, queueHolding('fx-other', 2));
    const hook = rowsFor(fakes);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.finish).toBeNull();
    // The match is decided; the return to the foreground reads again, and that read's ledger comes slowly.
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    let land: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (land = resolve));
    const loadLedger = fakes.ports.tapQueue.loadLedger.bind(fakes.ports.tapQueue);
    vi.spyOn(fakes.ports.tapQueue, 'loadLedger').mockImplementationOnce(async (id) => {
      await gate;
      return loadLedger(id);
    });
    act(() => fakes.foreground.leave());
    act(() => fakes.foreground.fire());
    await act(() => vi.advanceTimersByTimeAsync(10));
    // A poll tick starts and lands while that read is out, and says nothing of the match.
    const listed = vi.spyOn(fakes.ports.tapQueue, 'list');
    await act(() => vi.advanceTimersByTimeAsync(SCORING_POLL_MS));
    expect(listed).toHaveBeenCalled();
    expect(hook.result.current.finish).toBeNull();
    land();
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(hook.result.current.finish).toEqual(OVER);
  });

  it('reads once at mount when no runner is stopping, and does not wait for one that is not there', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    const read = vi.spyOn(fakes.ports.kv, 'get');
    const settled = vi.spyOn(scoringHubOf(fakes.ports), 'settled');
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    expect(hook.result.current.finish).toEqual(OVER);
    expect(settled).toHaveBeenCalledExactlyOnceWith(FAKE_MATCH);
    expect(linkReads(read)).toHaveLength(1);
  });

  it('stops listening for a return to the foreground once Home has gone', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    const listed = vi.spyOn(fakes.ports.tapQueue, 'list');
    hook.unmount();
    act(() => fakes.foreground.leave());
    act(() => fakes.foreground.fire());
    await act(async () => undefined);
    expect(listed).not.toHaveBeenCalled();
  });

  it('a runner that stops after Home has gone changes nothing and throws nothing', async () => {
    const fakes = createFakePorts();
    await leave(fakes, queueHolding(FAKE_MATCH, 0));
    await leaveHistory(fakes, FAKE_MATCH, DECIDED_MATCH);
    let stopped: () => void = () => undefined;
    const stopping = new Promise<void>((resolve) => (stopped = resolve));
    vi.spyOn(scoringHubOf(fakes.ports), 'settled').mockReturnValue(stopping);
    const hook = rowsFor(fakes);
    await act(async () => undefined);
    const listed = vi.spyOn(fakes.ports.tapQueue, 'list');
    hook.unmount();
    await act(async () => stopped());
    expect(listed).not.toHaveBeenCalled();
  });
});

describe('useContinueScoring', () => {
  it('does nothing when no match is saved: no mode made active, no route, no panel', async () => {
    const fakes = createFakePorts();
    await act(() => fakes.ports.modeStore.load());
    const setStatusKey = vi.fn();
    const saveFailed = vi.fn();
    const setPanel = vi.fn();
    const hook = renderHook(() => useContinueScoring(setStatusKey, saveFailed, setPanel), {
      wrapper: wrapperFor(fakes),
    });
    act(() => hook.result.current());
    await act(async () => undefined);
    expect(fakes.navigation.history).toEqual([]);
    expect(fakes.kv.entries.size).toBe(0);
    expect([setStatusKey, saveFailed, setPanel].map((spy) => spy.mock.calls.length)).toEqual([
      0, 0, 0,
    ]);
  });
});
