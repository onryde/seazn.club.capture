import { describe, expect, it } from 'vitest';
import {
  canDiscardQueued,
  discardQueued,
  isUnresolved,
  markSending,
  nextSend,
  onLedger,
  onRules,
  openSync,
  revalidate,
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
  answer,
} from '@/domain/scoring/sync.testkit';

const bodyFor = (key: string, payload: unknown, seq: number) => ({
  expected_seq: seq,
  type: 'badminton.rally',
  payload,
  idempotency_key: key,
  engine_epoch: 2,
  rules_version: 2,
});

describe('openSync', () => {
  it('holds the queue and the ledger, the tip at the ledger’s last seq, nothing in flight or waited for', () => {
    const queue = queueOf([A], { ownEventIds: ['ev-2'] });
    expect(
      openSync({ queue, ledger: [ev(1), ev(2), ev(3)], rulesVersion: 5, engineEpoch: 2 }),
    ).toEqual({
      tip: 3,
      ledger: [ev(1), ev(2), ev(3)],
      queue,
      rulesVersion: 5,
      engineEpoch: 2,
      status: 'idle',
      inFlight: null,
      notBefore: 0,
      conflictPasses: 0,
      rulesPasses: 0,
      hold: 'revalidate',
      decidedProbe: null,
      revalidateOwed: false,
      rulesRetryAt: null,
      rulesSaid: null,
      refusedRun: null,
    });
  });

  it('with no ledger the tip is 0, and with nothing queued there is nothing to revalidate', () => {
    const opened = openSync({ queue: queueOf([]), ledger: [], rulesVersion: 1, engineEpoch: 2 });
    expect(opened.tip).toBe(0);
    expect(opened.hold).toBeNull();
  });

  it('a queue read back dead opens dead', () => {
    const opened = openSync({
      queue: queueOf([A], { dead: 'LINK_REVOKED' }),
      ledger: [],
      rulesVersion: 1,
      engineEpoch: 2,
    });
    expect(opened.status).toBe('dead');
  });

  it('sends nothing until the queue has been revalidated', () => {
    const opened = openSync({
      queue: queueOf([A]),
      ledger: [ev(1)],
      rulesVersion: 2,
      engineEpoch: 2,
    });
    expect(nextSend(opened, NOW)).toBeNull();
    const looked = revalidate(opened, (queued) => queued.map((q) => q.key)).state;
    expect(nextSend(looked, NOW)).toMatchObject({ idempotency_key: 'key-a', expected_seq: 1 });
  });
});

describe('nextSend', () => {
  it('is the head of the queue, at the tip, with the epoch and the rules version', () => {
    expect(nextSend(restingOf(), NOW)).toEqual({
      expected_seq: 4,
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home' },
      idempotency_key: 'key-a',
      engine_epoch: 2,
      rules_version: 2,
    });
  });

  it('sends under the rules the phone holds now, not the ones the tap was made under', () => {
    const body = nextSend(restingOf({ rulesVersion: 3, queue: queueOf([A]) }), NOW);
    expect(body?.rules_version).toBe(3);
  });

  it('sends the tip as it moves', () => {
    expect(nextSend(restingOf({ tip: 9 }), NOW)?.expected_seq).toBe(9);
  });

  it('sends any event type with its payload as it was tapped', () => {
    const start = tap('key-s', { type: 'core.start', payload: {} });
    const sanction = tap('key-z', {
      type: 'badminton.sanction',
      payload: { by: 'ent-away', level: 'warning' },
    });
    expect(nextSend(restingOf({ queue: queueOf([start]) }), NOW)).toMatchObject({
      type: 'core.start',
      payload: {},
    });
    expect(nextSend(restingOf({ queue: queueOf([sanction]) }), NOW)).toMatchObject({
      type: 'badminton.sanction',
      payload: { by: 'ent-away', level: 'warning' },
    });
  });

  it('is null with nothing queued', () => {
    expect(nextSend(restingOf({ queue: queueOf([]) }), NOW)).toBeNull();
  });

  it('is null for an Undo that still waits for its tap’s answer: it names no event yet, and is never sent', () => {
    const waiting = tap('key-u', {
      type: 'core.void',
      payload: { event_id: '' },
      voidsKey: 'key-a',
    });
    expect(nextSend(restingOf({ queue: queueOf([waiting]) }), NOW)).toBeNull();
    const resolved = tap('key-u', { type: 'core.void', payload: { event_id: 'ev-2' } });
    expect(nextSend(restingOf({ queue: queueOf([resolved]) }), NOW)).toMatchObject({
      idempotency_key: 'key-u',
      payload: { event_id: 'ev-2' },
    });
  });

  it('is null while one is in flight: one at a time', () => {
    expect(nextSend(stateOf({ status: 'sending' }), NOW)).toBeNull();
  });

  it('is the head again after offline: a retry is the same tap, with the same key', () => {
    expect(nextSend(restingOf({ status: 'offline' }), NOW)?.idempotency_key).toBe('key-a');
  });

  it('is null while the app is Update needed', () => {
    expect(nextSend(restingOf({ status: 'outdated' }), NOW)).toBeNull();
  });

  it('is null once the link is dead', () => {
    expect(nextSend(restingOf({ status: 'dead' }), NOW)).toBeNull();
  });

  it.each([
    'LINK_INVALID',
    'LINK_REVOKED',
    'LINK_EXPIRED',
    'finalized',
    'forbidden',
    'gone',
    'payment',
  ] as const)(
    'is null for a queue read back from disk already dead (%s): nothing is sent anywhere',
    (dead) => {
      expect(nextSend(restingOf({ queue: queueOf([A, B], { dead }) }), NOW)).toBeNull();
    },
  );

  it.each(['ledger', 'rules', 'revalidate'] as const)(
    'is null while a %s hold stands: the picture it would send on is stale',
    (hold) => {
      expect(nextSend(restingOf({ hold }), NOW)).toBeNull();
      expect(nextSend(restingOf({ hold: null }), NOW)).not.toBeNull();
    },
  );

  it('is null until the wait is over, and sends at the very moment it is', () => {
    const waiting = restingOf({ notBefore: NOW + 1000 });
    expect(nextSend(waiting, NOW)).toBeNull();
    expect(nextSend(waiting, NOW + 999)).toBeNull();
    expect(nextSend(waiting, NOW + 1000)).toMatchObject({ idempotency_key: 'key-a' });
    expect(nextSend(waiting, NOW + 5000)).not.toBeNull();
  });
});

describe('markSending', () => {
  it('moves idle and offline to sending, with the head in flight', () => {
    for (const status of ['idle', 'offline'] as const) {
      const step = markSending(restingOf({ status }), NOW);
      expect(step.state.status).toBe('sending');
      expect(step.state.inFlight).toBe('key-a');
    }
  });

  it('counts the attempt on the head and saves it before the send goes', () => {
    const step = markSending(restingOf(), NOW);
    expect(step.state.queue.pending).toEqual([tap('key-a', { attempts: 1 }), B]);
    expect(step.effects).toEqual([{ kind: 'persist' }]);
  });

  it('adds one to the attempts it already had, and leaves the taps behind it alone', () => {
    const waiting = tap('key-b', { attempts: 7 });
    const step = markSending(
      restingOf({ queue: queueOf([tap('key-a', { attempts: 3 }), waiting]) }),
      NOW,
    );
    expect(step.state.queue.pending).toEqual([tap('key-a', { attempts: 4 }), waiting]);
  });

  it('changes only the queue, the status and the in-flight mark', () => {
    const state = restingOf({ conflictPasses: 1, rulesPasses: 2, notBefore: NOW - 5 });
    const step = markSending(state, NOW);
    expect(step.state).toEqual({
      ...state,
      status: 'sending',
      inFlight: 'key-a',
      queue: queueOf([tap('key-a', { attempts: 1 }), B]),
    });
  });

  it.each(['sending', 'outdated', 'dead'] as const)(
    'leaves %s as it is, saving nothing',
    (status) => {
      const state = stateOf({ status });
      const step = markSending(state, NOW);
      expect(step.state).toBe(state);
      expect(step.effects).toEqual([]);
    },
  );

  it('leaves an empty queue, a dead queue, a held one and one still waiting where they are', () => {
    const cases = [
      restingOf({ queue: queueOf([]) }),
      restingOf({ queue: queueOf([A], { dead: 'LINK_REVOKED' }) }),
      restingOf({ hold: 'ledger' }),
      restingOf({ notBefore: NOW + 1 }),
    ];
    for (const state of cases) {
      const step = markSending(state, NOW);
      expect(step.state).toBe(state);
      expect(step.effects).toEqual([]);
    }
  });

  it('once marked there is no second send', () => {
    const marked = markSending(restingOf(), NOW).state;
    expect(nextSend(marked, NOW)).toBeNull();
    expect(markSending(marked, NOW).state).toBe(marked);
  });
});

describe('a tap whose fate is unknown', () => {
  it('is unresolved when it has attempts, or is the one in flight, and not otherwise', () => {
    const state = restingOf({ queue: queueOf([tap('key-a', { attempts: 1 }), B, C]) });
    expect(isUnresolved(state, 'key-a')).toBe(true);
    expect(isUnresolved(state, 'key-b')).toBe(false);
    const flying = restingOf({ inFlight: 'key-b' });
    expect(isUnresolved(flying, 'key-b')).toBe(true);
    expect(isUnresolved(flying, 'key-a')).toBe(false);
  });

  it('is nothing for a key that is not queued', () => {
    expect(isUnresolved(restingOf({ inFlight: 'key-ghost' }), 'key-ghost')).toBe(false);
    expect(isUnresolved(restingOf(), 'key-ghost')).toBe(false);
  });

  it('may not be discarded by an undo: it may be in the ledger already', () => {
    const flying = stateOf();
    expect(canDiscardQueued(flying, 'key-a')).toBe(false);
    const step = discardQueued(flying, 'key-a');
    expect(step.state).toBe(flying);
    expect(step.effects).toEqual([]);
    const tried = restingOf({ queue: queueOf([tap('key-a', { attempts: 2 }), B]) });
    expect(canDiscardQueued(tried, 'key-a')).toBe(false);
    expect(discardQueued(tried, 'key-a').state).toBe(tried);
  });

  it('a tap only queued may be discarded, behind one in flight too, and the queue is saved', () => {
    const flying = stateOf();
    expect(canDiscardQueued(flying, 'key-b')).toBe(true);
    const step = discardQueued(flying, 'key-b');
    expect(step.state.queue.pending).toEqual([A]);
    expect(step.state.inFlight).toBe('key-a');
    expect(step.effects).toEqual([{ kind: 'persist' }]);
  });

  it('a key that is not queued cannot be discarded, and nothing changes', () => {
    const state = restingOf();
    expect(canDiscardQueued(state, 'key-ghost')).toBe(false);
    const step = discardQueued(state, 'key-ghost');
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
  });

  it('discards only the key it was asked for', () => {
    const step = discardQueued(restingOf({ queue: queueOf([A, B, C]) }), 'key-b');
    expect(step.state.queue.pending).toEqual([A, C]);
  });

  it('after an answer that says it was not stored it is only queued again, and may be discarded', () => {
    const sent = tap('key-a', { attempts: 1 });
    const conflicted = answer(stateOf({ queue: queueOf([sent, B]) }), sent, {
      kind: 'seqConflict',
      currentSeq: 6,
    }).state;
    expect(canDiscardQueued(conflicted, 'key-a')).toBe(true);
  });
});

describe('onAnswer: accepted', () => {
  it('moves the head into the ledger and the own ids, moves the tip, and sends the next', () => {
    const step = answer(stateOf(), A, accepted(5, 'ev-5'));
    expect(step.state).toEqual(
      stateOf({
        tip: 5,
        ledger: [
          ev(1),
          ev(2),
          ev(3),
          ev(4),
          {
            id: 'ev-5',
            seq: 5,
            type: 'badminton.rally',
            payload: { wonBy: 'ent-home' },
            recordedAt: '2026-11-02T10:00:00.000Z',
            voids: null,
            deviceLinkId: null,
          },
        ],
        queue: queueOf([tap('key-b', { ...B, attempts: 1 })], { ownEventIds: ['ev-5'] }),
        status: 'sending',
        inFlight: 'key-b',
      }),
    );
    expect(step.effects).toEqual([
      { kind: 'persist' },
      { kind: 'send', body: bodyFor('key-b', { wonBy: 'ent-away' }, 5) },
    ]);
  });

  it('with nothing behind it, persists and is idle, nothing in flight', () => {
    const step = answer(stateOf({ queue: queueOf([A]) }), A, accepted(5, 'ev-5'));
    expect(step.state.status).toBe('idle');
    expect(step.state.inFlight).toBeNull();
    expect(step.state.queue.pending).toEqual([]);
    expect(step.effects).toEqual([{ kind: 'persist' }]);
  });

  it('drains a queue in order, each send at the tip the last answer left', () => {
    const first = answer(stateOf(), A, accepted(5, 'ev-5'));
    const second = answer(first.state, B, accepted(6, 'ev-6'));
    expect(second.state.tip).toBe(6);
    expect(second.state.queue).toEqual(queueOf([], { ownEventIds: ['ev-5', 'ev-6'] }));
    expect(second.state.ledger.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(second.effects).toEqual([{ kind: 'persist' }]);
  });

  it('keeps the own ids it had, in order', () => {
    const state = stateOf({ queue: queueOf([A], { ownEventIds: ['ev-0'] }) });
    expect(answer(state, A, accepted(5, 'ev-5')).state.queue.ownEventIds).toEqual(['ev-0', 'ev-5']);
  });

  it('records a void as voiding the event its payload names', () => {
    const state = stateOf({ queue: queueOf([C]), inFlight: 'key-c' });
    const joined = answer(state, C, accepted(5, 'ev-5')).state.ledger[4];
    expect(joined).toMatchObject({ id: 'ev-5', type: 'core.void', voids: 'ev-2' });
  });

  it('records a void with no event id in its payload as voiding nothing', () => {
    const odd = tap('key-o', { type: 'core.void', payload: { event_id: 7 } });
    const none = tap('key-n', { type: 'core.void', payload: null });
    const first = answer(stateOf({ queue: queueOf([odd]) }), odd, accepted(5, 'ev-5'));
    const second = answer(stateOf({ queue: queueOf([none]) }), none, accepted(5, 'ev-5'));
    expect(first.state.ledger[4]?.voids).toBeNull();
    expect(second.state.ledger[4]?.voids).toBeNull();
  });

  it('does not take a rally for a void, whatever its payload says', () => {
    const rally = tap('key-r', { payload: { event_id: 'ev-2' } });
    const joined = answer(stateOf({ queue: queueOf([rally]) }), rally, accepted(5, 'ev-5'));
    expect(joined.state.ledger[4]?.voids).toBeNull();
  });

  it('is progress: the counts and the wait start again', () => {
    const state = stateOf({ conflictPasses: 2, rulesPasses: 2, notBefore: NOW + 9000 });
    const next = answer(state, A, accepted(5, 'ev-5')).state;
    expect(next.conflictPasses).toBe(0);
    expect(next.rulesPasses).toBe(0);
    expect(next.notBefore).toBe(0);
  });

  it('leaves the queued events behind it as they were, attempts and all', () => {
    const waiting = tap('key-c', { attempts: 3 });
    const step = answer(stateOf({ queue: queueOf([A, waiting]) }), A, accepted(5, 'ev-5'));
    expect(step.state.queue.pending).toEqual([tap('key-c', { attempts: 4 })]);
  });

  it('a seq it cannot place is counted, and the gap is fetched before anything else is sent', () => {
    const step = answer(stateOf(), A, accepted(9, 'ev-9'));
    expect(step.state.tip).toBe(4);
    expect(step.state.ledger).toEqual(stateOf().ledger);
    expect(step.state.queue).toEqual(queueOf([B], { ownEventIds: ['ev-9'] }));
    expect(step.state.status).toBe('idle');
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 4 }]);
  });

  it('sends nothing at all until that fetch has merged (nextSend is null, then the next tap goes)', () => {
    const gap = answer(stateOf(), A, accepted(9, 'ev-9')).state;
    expect(gap.hold).toBe('ledger');
    expect(nextSend(gap, NOW)).toBeNull();
    const fetched = onLedger(gap, [ev(5), ev(6), ev(7), ev(8), ev(9, { id: 'ev-9' })]).state;
    expect(nextSend(fetched, NOW)).toBeNull();
    const looked = revalidate(fetched, (queued) => queued.map((q) => q.key)).state;
    expect(nextSend(looked, NOW)).toMatchObject({ idempotency_key: 'key-b', expected_seq: 9 });
  });

  it('an answer for a tap that left the queue meanwhile is still the server’s event (defensive: undo cannot do this)', () => {
    const step = answer(stateOf({ queue: queueOf([B]), inFlight: null }), A, accepted(5, 'ev-5'));
    expect(step.state.queue.ownEventIds).toEqual(['ev-5']);
    expect(step.state.ledger.map((e) => e.id)).toEqual(['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5']);
    expect(step.state.tip).toBe(5);
  });

  it('leaves another tap’s in-flight mark alone: only its own answer clears it', () => {
    const step = answer(
      stateOf({ queue: queueOf([A]), inFlight: 'key-x' }),
      A,
      accepted(5, 'ev-5'),
    );
    expect(step.state.inFlight).toBe('key-x');
  });

  it('rules newer than the phone’s, named in the answer, are fetched before anything is sent', () => {
    const step = answer(stateOf(), A, accepted(5, 'ev-5', 3));
    expect(step.state.rulesVersion).toBe(2);
    expect(step.state.hold).toBe('rules');
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'reloadRules' }]);
    expect(nextSend(step.state, NOW)).toBeNull();
  });

  it('rules the same as the phone’s, or older, change nothing: the next tap goes', () => {
    for (const version of [2, 1, 0]) {
      const step = answer(stateOf(), A, accepted(5, 'ev-5', version));
      expect(step.state.rulesVersion).toBe(2);
      expect(step.state.hold).toBeNull();
      expect(step.effects.map((effect) => effect.kind)).toEqual(['persist', 'send']);
    }
  });

  it('a gap beats new rules: the ledger is fetched first', () => {
    const step = answer(stateOf(), A, accepted(9, 'ev-9', 3));
    expect(step.state.hold).toBe('ledger');
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 4 }]);
  });

  it('keeps the tip the ledger’s last seq, however it is placed', () => {
    const fetched = restingOf({ tip: 5, ledger: [ev(1), ev(2), ev(3), ev(4), ev(5)] });
    const cases = [
      answer(stateOf(), A, accepted(5, 'ev-5')).state,
      answer(stateOf(), A, accepted(9, 'ev-9')).state,
      answer(fetched, A, accepted(3, 'ev-3')).state,
      answer(fetched, A, accepted(5, 'ev-5')).state,
      answer(stateOf({ tip: 0, ledger: [] }), A, accepted(1, 'ev-1')).state,
    ];
    for (const state of cases) expect(state.tip).toBe(state.ledger.at(-1)?.seq ?? 0);
  });
});

// Review Focus 2: the answer lost after the server accepted.
describe('onAnswer: a replayed accept counts once (Review Focus 2)', () => {
  it('the resend after a lost answer is answered with the original event id: one own id, one ledger event', () => {
    const sent = tap('key-a', { attempts: 1 });
    const lost = restingOf({ status: 'offline', queue: queueOf([sent]) });
    const step = answer(lost, sent, accepted(5, 'ev-5'));
    expect(step.state.queue.ownEventIds).toEqual(['ev-5']);
    expect(step.state.ledger.filter((e) => e.id === 'ev-5')).toHaveLength(1);
    expect(step.state.queue.pending).toEqual([]);
    expect(step.state.tip).toBe(5);
  });

  it('when a fetch already brought the event in, the replayed accept adds nothing to the ledger', () => {
    const fetched = stateOf({
      tip: 5,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5, { deviceLinkId: 'link-this-phone' })],
      status: 'sending',
    });
    const step = answer(fetched, A, accepted(5, 'ev-5'));
    expect(step.state.ledger).toHaveLength(5);
    expect(step.state.ledger[4]).toEqual(ev(5, { deviceLinkId: 'link-this-phone' }));
    expect(step.state.queue).toEqual(queueOf([B], { ownEventIds: ['ev-5'] }));
    expect(step.state.tip).toBe(5);
    expect(step.state.status).toBe('idle');
  });

  // The queue behind was judged while the head stood in the ledger AND the queue: it is judged again now that the
  // duplicate is gone, before anything is sent.
  it('a replayed accept of an event the ledger holds holds the queue behind it for a revalidation', () => {
    const fetched = stateOf({
      tip: 5,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5, { deviceLinkId: 'link-this-phone' })],
    });
    const step = answer(fetched, A, accepted(5, 'ev-5'));
    expect(step.state.hold).toBe('revalidate');
    expect(step.effects).toEqual([{ kind: 'persist' }]);
    expect(nextSend(step.state, NOW)).toBeNull();
    const looked = revalidate(step.state, (queued) => queued.map((q) => q.key)).state;
    expect(nextSend(looked, NOW)).toMatchObject({ idempotency_key: 'key-b', expected_seq: 5 });
  });

  it('a replayed accept with nothing queued behind it holds nothing', () => {
    const fetched = stateOf({
      queue: queueOf([A]),
      tip: 5,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5)],
    });
    const step = answer(fetched, A, accepted(5, 'ev-5'));
    expect(step.state.hold).toBeNull();
    expect(step.state.revalidateOwed).toBe(false);
  });

  it('an accept that places a new event holds nothing: the tap behind goes at once', () => {
    expect(answer(stateOf(), A, accepted(5, 'ev-5')).state.hold).toBeNull();
  });

  it('a revalidation still owed is done before the tap behind goes, and then it is not owed', () => {
    const step = answer(stateOf({ revalidateOwed: true }), A, accepted(5, 'ev-5'));
    expect(step.state.hold).toBe('revalidate');
    expect(step.effects).toEqual([{ kind: 'persist' }]);
    expect(revalidate(step.state, (queued) => queued.map((q) => q.key)).state.revalidateOwed).toBe(
      false,
    );
  });

  it('a revalidation owed with nothing queued behind is dropped, not carried', () => {
    const step = answer(
      stateOf({ queue: queueOf([A]), revalidateOwed: true }),
      A,
      accepted(5, 'ev-5'),
    );
    expect(step.state.revalidateOwed).toBe(false);
    expect(step.state.hold).toBeNull();
  });

  it('new rules named beside a duplicate are fetched first, and the revalidation stays owed', () => {
    const fetched = stateOf({ tip: 5, ledger: [ev(1), ev(2), ev(3), ev(4), ev(5)] });
    const step = answer(fetched, A, accepted(5, 'ev-5', 3));
    expect(step.state.hold).toBe('rules');
    expect(onRules(step.state, { rulesVersion: 3 }).hold).toBe('revalidate');
  });

  it('another scorer’s event at that seq is not the tap: counted as the server’s, and a fetch follows', () => {
    const other = stateOf({
      tip: 5,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5, { id: 'ev-other-5' })],
    });
    const step = answer(other, A, accepted(5, 'ev-5'));
    expect(step.state.ledger).toEqual([ev(1), ev(2), ev(3), ev(4), ev(5, { id: 'ev-other-5' })]);
    expect(step.state.queue).toEqual(queueOf([B], { ownEventIds: ['ev-5'] }));
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 5 }]);
  });

  it('a replay that names a seq behind the tip never moves the tip back', () => {
    const behind = stateOf({
      tip: 7,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5), ev(6), ev(7)],
    });
    expect(answer(behind, A, accepted(5, 'ev-5')).state.tip).toBe(7);
  });

  it('the same answer delivered twice is the same as once, and sends nothing twice', () => {
    const once = answer(stateOf(), A, accepted(5, 'ev-5'));
    const twice = answer(once.state, A, accepted(5, 'ev-5'));
    expect(twice.state).toBe(once.state);
    expect(twice.effects).toEqual([]);
  });
});
