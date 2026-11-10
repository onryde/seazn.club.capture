import { describe, expect, it, vi } from 'vitest';
import type { QueuedEvent } from '@/domain/scoring/queue';
import {
  canDiscardQueued,
  discardQueued,
  markSending,
  nextSend,
  NO_LONGER_LEGAL,
  onLedger,
  onRules,
  openSync,
  revalidate,
  type SyncState,
} from '@/domain/scoring/sync';
import {
  NOW,
  tap,
  A,
  B,
  C,
  ev,
  queueOf,
  stateOf,
  restingOf,
  accepted,
  refusal,
  answer,
} from '@/domain/scoring/sync.testkit';

describe('onLedger', () => {
  it('adds what was fetched, in order, and moves the tip to the last of it', () => {
    const state = restingOf({ conflictPasses: 1 });
    const step = onLedger(state, [ev(5), ev(6)]);
    expect(step.state).toEqual({
      ...state,
      tip: 6,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5), ev(6)],
      hold: 'revalidate',
    });
    expect(step.effects).toEqual([]);
  });

  // The post-close read (fix round 1) lands on a queue nobody judges: its taps are leftovers, kept whole, so the new
  // events do not hold it for a revalidation that would drop the ones they make illegal.
  it.each(['carriedForward', 'finalized', 'cancelled', 'LINK_REVOKED'] as const)(
    'on a queue dead as %s adds the events and the tip, and holds nothing for a revalidation',
    (dead) => {
      const state = restingOf({ status: 'dead', queue: queueOf([A, B], { dead }) });
      const step = onLedger(state, [ev(5)]);
      expect(step.state.tip).toBe(5);
      expect(step.state.ledger).toEqual([ev(1), ev(2), ev(3), ev(4), ev(5)]);
      expect(step.state.hold).toBeNull();
      expect(step.state.queue).toBe(state.queue);
      expect(step.effects).toEqual([]);
    },
  );

  it('a dead queue’s hold on its own read is let go, never turned into a revalidation', () => {
    const state = restingOf({
      status: 'dead',
      hold: 'ledger',
      queue: queueOf([A], { dead: 'carriedForward' }),
    });
    expect(onLedger(state, [ev(5)]).state.hold).toBeNull();
    expect(onLedger(state, []).state.hold).toBeNull();
  });

  it('with nothing fetched and nothing owed is the same state, not a copy', () => {
    const state = restingOf();
    const step = onLedger(state, []);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
  });

  it('takes the first events of a match', () => {
    const empty = restingOf({ tip: 0, ledger: [] });
    const step = onLedger(empty, [ev(1)]);
    expect(step.state.tip).toBe(1);
  });

  // A batch must continue the ledger: a hole would fold into a match that never was.
  it.each([
    ['one that starts beyond the tip + 1', [ev(6)]],
    ['one that starts at the tip', [ev(4)]],
    ['one that starts behind it', [ev(2), ev(3), ev(4), ev(5)]],
    ['one with a hole in it', [ev(5), ev(7)]],
    ['one that repeats a seq', [ev(5), ev(5)]],
    ['one out of order', [ev(6), ev(5)]],
  ] as const)('refuses %s whole, and fetches again from the tip', (_name, batch) => {
    const state = restingOf({ hold: 'ledger' });
    const step = onLedger(state, batch);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
  });

  it('the tip is always the ledger’s last seq, whatever came in', () => {
    let state = restingOf({ tip: 0, ledger: [] });
    for (const batch of [[ev(1), ev(2)], [], [ev(9)], [ev(3)], [ev(4), ev(5), ev(6)], [ev(7)]]) {
      state = onLedger(state, batch).state;
      expect(state.tip).toBe(state.ledger.at(-1)?.seq ?? 0);
    }
    expect(state.tip).toBe(7);
  });

  it('keeps what voids what', () => {
    const voiding = ev(5, { type: 'core.void', voids: 'ev-3' });
    expect(onLedger(restingOf(), [voiding]).state.ledger[4]?.voids).toBe('ev-3');
  });

  it('leaves the queue, the status and the counts to the answers', () => {
    const state = restingOf({ status: 'offline', conflictPasses: 2 });
    const next = onLedger(state, [ev(5)]).state;
    expect(next.queue).toBe(state.queue);
    expect(next.status).toBe('offline');
    expect(next.conflictPasses).toBe(2);
    expect(next.rulesVersion).toBe(2);
  });

  describe('the hold', () => {
    it('new events hold the queue until it is revalidated, wherever the fetch came from', () => {
      expect(onLedger(restingOf({ hold: null }), [ev(5)]).state.hold).toBe('revalidate');
      expect(onLedger(restingOf({ hold: 'ledger' }), [ev(5)]).state.hold).toBe('revalidate');
      expect(onLedger(restingOf({ hold: 'revalidate' }), [ev(5)]).state.hold).toBe('revalidate');
    });

    it('a fetch asked for that brings nothing new releases its hold', () => {
      const step = onLedger(restingOf({ hold: 'ledger' }), []);
      expect(step.state.hold).toBeNull();
      expect(step.effects).toEqual([]);
    });

    it('rules still owed are not released by a ledger fetch, new events or not', () => {
      expect(onLedger(restingOf({ hold: 'rules' }), [ev(5)]).state.hold).toBe('rules');
      expect(onLedger(restingOf({ hold: 'rules' }), []).state.hold).toBe('rules');
    });

    it('a revalidation still owed is not released by an empty fetch', () => {
      expect(onLedger(restingOf({ hold: 'revalidate' }), []).state.hold).toBe('revalidate');
    });

    it('a status read still owed is not released by a ledger fetch, new events or not', () => {
      expect(onLedger(restingOf({ hold: 'status' }), [ev(5)]).state.hold).toBe('status');
      expect(onLedger(restingOf({ hold: 'status' }), []).state.hold).toBe('status');
    });

    it('a revalidation owed (a head unresolved while it was asked) comes back with any fetch, empty or not', () => {
      expect(onLedger(restingOf({ revalidateOwed: true }), []).state.hold).toBe('revalidate');
      expect(onLedger(restingOf({ revalidateOwed: true, hold: 'ledger' }), []).state.hold).toBe(
        'revalidate',
      );
      expect(
        onLedger(restingOf({ revalidateOwed: false, hold: 'ledger' }), []).state.hold,
      ).toBeNull();
    });
  });
});

describe('revalidate', () => {
  it('keeps everything legal returns, asked about the queue in order', () => {
    const state = restingOf();
    const legal = vi.fn((queued: readonly QueuedEvent[]) => queued.map((q) => q.key));
    const step = revalidate(state, legal);
    expect(legal).toHaveBeenCalledTimes(1);
    expect(legal).toHaveBeenCalledWith([A, B]);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
  });

  it('drops what is no longer legal, says so for each, and persists', () => {
    const step = revalidate(restingOf({ queue: queueOf([A, B, C]) }), () => ['key-b']);
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects).toEqual([
      { kind: 'refused', key: 'key-a', code: NO_LONGER_LEGAL },
      { kind: 'refused', key: 'key-c', code: NO_LONGER_LEGAL },
      { kind: 'persist' },
    ]);
  });

  it('keeps the queue’s order, whatever order legal answers in', () => {
    const step = revalidate(restingOf({ queue: queueOf([A, B, C]) }), () => [
      'key-c',
      'key-a',
      'key-b',
    ]);
    expect(step.state.queue.pending).toEqual([A, B, C]);
    expect(step.effects).toEqual([]);
  });

  it('never adds a tap legal names that is not queued', () => {
    const step = revalidate(restingOf(), () => ['key-a', 'key-b', 'key-ghost']);
    expect(step.state.queue.pending).toEqual([A, B]);
    expect(step.effects).toEqual([]);
  });

  it('an empty queue has nothing to ask about', () => {
    const state = restingOf({ queue: queueOf([]) });
    const legal = vi.fn(() => ['key-ghost']);
    const step = revalidate(state, legal);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
    expect(legal).not.toHaveBeenCalled();
  });

  it('changes nothing but the queue: not the tip, the ledger, the status or the own ids', () => {
    const state = restingOf({
      conflictPasses: 1,
      queue: queueOf([A, B], { ownEventIds: ['ev-3'] }),
    });
    const step = revalidate(state, () => []);
    expect(step.state).toEqual({ ...state, queue: queueOf([], { ownEventIds: ['ev-3'] }) });
  });

  it('keeps the taps’ own counts', () => {
    const waiting = tap('key-b', { attempts: 4 });
    const step = revalidate(restingOf({ queue: queueOf([A, waiting]) }), () => ['key-b']);
    expect(step.state.queue.pending).toEqual([waiting]);
  });

  // While the head's fate is unknown the ledger may hold it already, so the queue (which holds it too) and the ledger
  // together count it twice: what is behind it cannot be judged on that picture, and nothing is dropped.
  describe('a head whose fate is unknown: nothing is dropped', () => {
    it('one that was tried (attempts): it and the ones behind it stay, whatever legal says', () => {
      const tried = tap('key-a', { attempts: 2 });
      const legal = vi.fn(() => []);
      const step = revalidate(restingOf({ queue: queueOf([tried, B]) }), legal);
      expect(step.state.queue.pending).toEqual([tried, B]);
      expect(step.effects).toEqual([]);
      expect(legal).not.toHaveBeenCalled();
    });

    it('the one on its way: it and the ones behind it stay, though its own event may be what made them illegal', () => {
      const step = revalidate(stateOf(), () => []);
      expect(step.state.queue.pending).toEqual([A, B]);
      expect(step.effects).toEqual([]);
    });

    it('the hold is lifted, so the head can be resent, and the revalidation is owed', () => {
      const tried = tap('key-a', { attempts: 2 });
      const step = revalidate(
        restingOf({ hold: 'revalidate', queue: queueOf([tried, B]) }),
        () => [],
      );
      expect(step.state.hold).toBeNull();
      expect(step.state.revalidateOwed).toBe(true);
      expect(nextSend(step.state, NOW)).toMatchObject({ idempotency_key: 'key-a' });
    });

    it('a tap that was judged leaves nothing owed', () => {
      const step = revalidate(restingOf({ revalidateOwed: true }), (queued) =>
        queued.map((q) => q.key),
      );
      expect(step.state.revalidateOwed).toBe(false);
      const dropping = revalidate(restingOf({ revalidateOwed: true }), () => []);
      expect(dropping.state.revalidateOwed).toBe(false);
      const empty = revalidate(restingOf({ revalidateOwed: true, queue: queueOf([]) }), () => []);
      expect(empty.state.revalidateOwed).toBe(false);
    });

    it('an unresolved tap that is not the head is still never dropped (a queue read back oddly)', () => {
      const odd = tap('key-x', { attempts: 1 });
      const step = revalidate(restingOf({ queue: queueOf([B, odd]) }), () => []);
      expect(step.state.queue.pending).toEqual([odd]);
      expect(step.effects).toEqual([
        { kind: 'refused', key: 'key-b', code: NO_LONGER_LEGAL },
        { kind: 'persist' },
      ]);
    });

    it('nothing is said of it: no NO_LONGER_LEGAL for a tap kept', () => {
      const step = revalidate(stateOf({ queue: queueOf([A]) }), () => []);
      expect(step.state.queue.pending).toEqual([A]);
      expect(step.effects).toEqual([]);
    });

    it('once the head is answered as not stored, it is only queued again and the queue is judged', () => {
      const tried = tap('key-a', { attempts: 1 });
      const conflicted = answer(stateOf({ queue: queueOf([tried, B]) }), tried, {
        kind: 'seqConflict',
        currentSeq: 6,
      }).state;
      const fetched = onLedger(conflicted, [ev(5), ev(6)]).state;
      const step = revalidate(fetched, () => ['key-a']);
      expect(step.state.queue.pending).toEqual([A]);
      expect(step.effects).toEqual([
        { kind: 'refused', key: 'key-b', code: NO_LONGER_LEGAL },
        { kind: 'persist' },
      ]);
    });
  });

  describe('the hold', () => {
    it('lifts the revalidation hold, even with nothing to drop, and from an empty queue', () => {
      const step = revalidate(restingOf({ hold: 'revalidate' }), (queued) =>
        queued.map((q) => q.key),
      );
      expect(step.state.hold).toBeNull();
      expect(step.effects).toEqual([]);
      const empty = restingOf({ hold: 'revalidate', queue: queueOf([]) });
      expect(revalidate(empty, () => []).state.hold).toBeNull();
    });

    it('lifts it when it drops taps too', () => {
      const step = revalidate(restingOf({ hold: 'revalidate' }), () => []);
      expect(step.state.hold).toBeNull();
      expect(step.state.queue.pending).toEqual([]);
    });

    it.each(['ledger', 'rules'] as const)(
      'leaves a %s hold alone: its fetch has not landed',
      (hold) => {
        const state = restingOf({ hold });
        const step = revalidate(state, (queued) => queued.map((q) => q.key));
        expect(step.state).toBe(state);
        expect(revalidate(state, () => []).state.hold).toBe(hold);
      },
    );
  });
});

// Review Focus 3: another scorer finished the game while this phone was offline.
describe('a rally made illegal by another scorer (Review Focus 3)', () => {
  const OTHER_FINISHED = ev(5, {
    type: 'core.forfeit',
    payload: { by: 'ent-away', reason: 'disqualified' },
  });
  // The rule the test stands in for (the engine's fold, Task 7): after a forfeit nothing else is legal.
  const legalAfterForfeit = (state: SyncState) => (queued: readonly QueuedEvent[]) =>
    state.ledger.some((e) => e.type === 'core.forfeit') ? [] : queued.map((q) => q.key);

  it('leaves the queue, is said not to have counted, and is never sent', () => {
    const offline = restingOf({ status: 'offline', queue: queueOf([A, B]) });
    const fetched = onLedger(offline, [OTHER_FINISHED]).state;
    const step = revalidate(fetched, legalAfterForfeit(fetched));
    expect(step.state.queue.pending).toEqual([]);
    expect(step.effects).toEqual([
      { kind: 'refused', key: 'key-a', code: NO_LONGER_LEGAL },
      { kind: 'refused', key: 'key-b', code: NO_LONGER_LEGAL },
      { kind: 'persist' },
    ]);
    expect(nextSend({ ...step.state, status: 'idle' }, NOW)).toBeNull();
  });

  it('a tap already tried is resent, and the queue behind it is judged once that is answered', () => {
    const tried = tap('key-a', { attempts: 2 });
    const offline = restingOf({ status: 'offline', queue: queueOf([tried, B]) });
    const fetched = onLedger(offline, [OTHER_FINISHED]).state;
    const step = revalidate(fetched, legalAfterForfeit(fetched));
    expect(step.state.queue.pending).toEqual([tried, B]);
    expect(step.effects).toEqual([]);
    expect(nextSend(step.state, NOW)).toMatchObject({ idempotency_key: 'key-a', expected_seq: 5 });
    // the server refuses the resend (the game is over): the queue behind is looked at before it goes
    const resent = markSending(step.state, NOW).state;
    const refused = answer(resent, tried, refusal('WRONG_PHASE'));
    expect(refused.state.hold).toBe('ledger');
    const landed = onLedger(refused.state, []).state;
    expect(landed.hold).toBe('revalidate');
    const judged = revalidate(landed, legalAfterForfeit(landed));
    expect(judged.state.queue.pending).toEqual([]);
    expect(judged.effects[0]).toEqual({ kind: 'refused', key: 'key-b', code: NO_LONGER_LEGAL });
  });

  it('what is still legal stays and goes on at the new tip', () => {
    const fetched = onLedger(restingOf({ status: 'offline' }), [ev(5)]).state;
    const step = revalidate(fetched, () => ['key-b']);
    expect(step.state.queue.pending).toEqual([B]);
    expect(nextSend(step.state, NOW)).toMatchObject({ idempotency_key: 'key-b', expected_seq: 5 });
  });

  it('the same after the organiser’s rules change under it: reload, then revalidate', () => {
    const changed = answer(stateOf(), A, { kind: 'rulesChanged', rulesVersion: 3 });
    expect(changed.effects).toEqual([{ kind: 'reloadRules' }]);
    const taken = onRules(changed.state, { rulesVersion: 3 });
    const step = revalidate(taken, () => ['key-b']);
    expect(step.state.rulesVersion).toBe(3);
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects).toEqual([
      { kind: 'refused', key: 'key-a', code: NO_LONGER_LEGAL },
      { kind: 'persist' },
    ]);
  });
});

// The send whose answer never came, while the match moved on: the ledger may hold the tap already.
describe('a tap whose answer was lost, and a ledger that now holds it', () => {
  // The fold's rule the test stands in for: once a rally ended the game, a further rally is illegal.
  const nothingLegalAfter = (state: SyncState) => (queued: readonly QueuedEvent[]) =>
    state.ledger.some((e) => e.id === 'ev-5') ? [] : queued.map((q) => q.key);

  it('a fetch bringing the in-flight tap’s own game-ending event does not drop it: no NO_LONGER_LEGAL', () => {
    const flying = markSending(restingOf({ queue: queueOf([A]) }), NOW).state;
    const fetched = onLedger(flying, [
      ev(5, { id: 'ev-5', deviceLinkId: 'link-this-phone' }),
    ]).state;
    const step = revalidate(fetched, nothingLegalAfter(fetched));
    expect(step.state.queue.pending).toEqual([tap('key-a', { attempts: 1 })]);
    expect(step.effects).toEqual([]);
  });

  it('and its answer, when it comes, counts once and is the server’s event', () => {
    const flying = markSending(restingOf({ queue: queueOf([A]) }), NOW).state;
    const fetched = onLedger(flying, [ev(5, { id: 'ev-5' })]).state;
    const looked = revalidate(fetched, nothingLegalAfter(fetched)).state;
    const landed = answer(looked, A, accepted(5, 'ev-5'));
    expect(landed.state.queue.ownEventIds).toEqual(['ev-5']);
    expect(landed.state.queue.pending).toEqual([]);
    expect(landed.state.ledger.filter((e) => e.id === 'ev-5')).toHaveLength(1);
    expect(landed.state.tip).toBe(5);
  });

  // The deciding game at 19-19 (the ledger's four events stand for it): the head H is the 20th point, T1 behind it the
  // 21st, which wins the match. A fetch brings H's own event in while its answer is lost, so the ledger and the queue
  // both hold H, and a fold of both sees H twice.
  describe('the deciding game at 19-19 (the match winner is queued behind a tap the server already holds)', () => {
    const H = tap('key-h', { payload: { wonBy: 'ent-home', point: 20 }, attempts: 1 });
    const T1 = tap('key-t1', { payload: { wonBy: 'ent-home', point: 21 } });
    // The rule the test stands in for: the game is over at two points past the four events of 19-19, and a rally
    // after it is illegal. Points are the ledger's past the 19-19, then the queue's in order.
    const legalAt = (state: SyncState) => (queued: readonly QueuedEvent[]) => {
      const played = state.ledger.filter((e) => e.seq > 4).length;
      return queued.filter((_q, i) => played + i < 2).map((q) => q.key);
    };
    const lostAnswer = () =>
      restingOf({ status: 'offline', queue: queueOf([H, T1]), notBefore: 0 });
    const withHeld = () =>
      onLedger(lostAnswer(), [ev(5, { id: 'ev-h', deviceLinkId: 'link-mine' })]).state;

    it('T1 is not dropped while H is unresolved, though a fold of ledger and queue would end the game early', () => {
      const held = withHeld();
      expect(legalAt(held)([H, T1])).toEqual(['key-h']);
      const step = revalidate(held, legalAt(held));
      expect(step.state.queue.pending).toEqual([H, T1]);
      expect(step.effects).toEqual([]);
      expect(nextSend(step.state, NOW)).toMatchObject({
        idempotency_key: 'key-h',
        expected_seq: 5,
      });
    });

    it('the resend is answered with the original event: the duplicate is gone, and T1 is then judged and goes', () => {
      const looked = revalidate(withHeld(), legalAt(withHeld())).state;
      const resent = markSending(looked, NOW).state;
      const landed = answer(resent, H, accepted(5, 'ev-h'));
      expect(landed.state.ledger.filter((e) => e.id === 'ev-h')).toHaveLength(1);
      expect(landed.state.queue.pending).toEqual([T1]);
      expect(landed.state.hold).toBe('revalidate');
      expect(landed.effects).toEqual([{ kind: 'persist' }]);
      const judged = revalidate(landed.state, legalAt(landed.state));
      expect(judged.state.queue.pending).toEqual([T1]);
      expect(judged.effects).toEqual([]);
      expect(nextSend(judged.state, NOW)).toMatchObject({
        idempotency_key: 'key-t1',
        expected_seq: 5,
      });
    });

    it('a reopened queue (attempts counted) is the same case, from the start', () => {
      const reopened = openSync({
        queue: queueOf([H, T1]),
        ledger: [ev(1), ev(2), ev(3), ev(4), ev(5, { id: 'ev-h' })],
        rulesVersion: 2,
        engineEpoch: 2,
      });
      const step = revalidate(reopened, legalAt(reopened));
      expect(step.state.queue.pending).toEqual([H, T1]);
      expect(step.effects).toEqual([]);
    });
  });

  it('while it is in flight Undo cannot delete it, so the ledger and the queue never both lose it', () => {
    const flying = markSending(restingOf({ queue: queueOf([A, B]) }), NOW).state;
    expect(canDiscardQueued(flying, 'key-a')).toBe(false);
    expect(discardQueued(flying, 'key-a').state).toBe(flying);
    expect(canDiscardQueued(flying, 'key-b')).toBe(true);
  });
});

describe('a queue read back after the app was killed', () => {
  const reopened = (tried: QueuedEvent) =>
    openSync({
      queue: queueOf([tried, B], { ownEventIds: ['ev-4'] }),
      ledger: [ev(1), ev(2), ev(3), ev(4)],
      rulesVersion: 2,
      engineEpoch: 2,
    });

  it('sends what was queued, once, with the key it was tapped under', () => {
    const state = revalidate(reopened(tap('key-a', { attempts: 3 })), (q) =>
      q.map((t) => t.key),
    ).state;
    expect(nextSend(state, NOW)).toMatchObject({ idempotency_key: 'key-a', expected_seq: 4 });
    const marked = markSending(state, NOW);
    expect(marked.state.status).toBe('sending');
    expect(marked.state.queue.pending[0]?.attempts).toBe(4);
    expect(nextSend(marked.state, NOW)).toBeNull();
  });

  it('a head with attempts is kept until a resend answers, though the ledger now makes it illegal', () => {
    const tried = tap('key-a', { attempts: 2 });
    const state = revalidate(reopened(tried), () => []).state;
    expect(state.queue.pending).toEqual([tried, B]);
    const resent = markSending(state, NOW).state;
    const landed = answer(resent, tried, accepted(5, 'ev-5'));
    expect(landed.state.queue.ownEventIds).toEqual(['ev-4', 'ev-5']);
    expect(landed.state.queue.pending).toEqual([B]);
  });

  it('the resend of a tap the server refused meanwhile is answered with that refusal, and only then dropped', () => {
    const tried = tap('key-a', { attempts: 2 });
    const state = revalidate(reopened(tried), () => []).state;
    const resent = markSending(state, NOW).state;
    const step = answer(resent, tried, refusal('WRONG_PHASE'));
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects[0]).toEqual({ kind: 'refused', key: 'key-a', code: 'WRONG_PHASE' });
    expect(step.state.hold).toBe('ledger');
    expect(onLedger(step.state, []).state.hold).toBe('revalidate');
  });

  it('is not sent before it is looked at, and a dead queue is not sent at all', () => {
    expect(nextSend(reopened(A), NOW)).toBeNull();
    const dead = openSync({
      queue: queueOf([A], { dead: 'gone' }),
      ledger: [],
      rulesVersion: 2,
      engineEpoch: 2,
    });
    expect(nextSend(revalidate(dead, (q) => q.map((t) => t.key)).state, NOW)).toBeNull();
  });
});
