import { describe, expect, it, vi } from 'vitest';
import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import {
  canDiscardQueued,
  discardQueued,
  isUnresolved,
  markSending,
  nextSend,
  NO_LONGER_LEGAL,
  onAnswer,
  onBootstrapStatus,
  onFetchFailed,
  onLedger,
  onReadFailed,
  onRules,
  openSync,
  revalidate,
  type SyncState,
} from '@/domain/scoring/sync';
import type { AppendAnswer, LedgerEvent } from '@/domain/scoring/wire';

/** The caller's clock, in ms: only its differences matter. */
const NOW = 1_000_000;

const tap = (key: string, overrides: Partial<QueuedEvent> = {}): QueuedEvent => ({
  key,
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  rulesVersion: 2,
  createdAt: '2026-11-02T10:00:00.000Z',
  attempts: 0,
  ...overrides,
});

const A = tap('key-a');
const B = tap('key-b', { payload: { wonBy: 'ent-away' }, createdAt: '2026-11-02T10:00:05.000Z' });
const C = tap('key-c', { type: 'core.void', payload: { event_id: 'ev-2' } });

const ev = (seq: number, overrides: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: `ev-${seq}`,
  seq,
  type: 'badminton.rally',
  payload: { wonBy: 'ent-home' },
  recordedAt: `2026-11-02T09:00:0${seq}.000Z`,
  voids: null,
  deviceLinkId: 'link-other',
  ...overrides,
});

const queueOf = (
  pending: readonly QueuedEvent[],
  overrides: Partial<MatchQueue> = {},
): MatchQueue => ({
  fixtureId: 'fixture-1',
  label: 'Match 4',
  pending,
  ownEventIds: [],
  dead: null,
  ...overrides,
});

/** Mid-send by default: the head, A, is on its way (the unit tests do not need its attempts to say so). */
const stateOf = (overrides: Partial<SyncState> = {}): SyncState => ({
  tip: 4,
  ledger: [ev(1), ev(2), ev(3), ev(4)],
  queue: queueOf([A, B]),
  rulesVersion: 2,
  engineEpoch: 2,
  status: 'sending',
  inFlight: 'key-a',
  notBefore: 0,
  conflictPasses: 0,
  rulesPasses: 0,
  hold: null,
  decidedProbe: null,
  revalidateOwed: false,
  ...overrides,
});

/** Nothing on its way: what a state is between an answer and the next send. */
const restingOf = (overrides: Partial<SyncState> = {}): SyncState =>
  stateOf({ status: 'idle', inFlight: null, ...overrides });

const accepted = (seq: number, eventId: string, rulesVersion = 2): AppendAnswer => ({
  kind: 'accepted',
  seq,
  eventId,
  rulesVersion,
});

const refusal = (code: string, status = 422): AppendAnswer => ({ kind: 'refused', status, code });

const answer = (state: SyncState, sent: QueuedEvent, said: AppendAnswer, now = NOW) =>
  onAnswer(state, sent, said, now);

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

describe('onAnswer: seqConflict', () => {
  const conflict: AppendAnswer = { kind: 'seqConflict', currentSeq: 6 };

  it('counts a pass and fetches from the tip, holds the queue until it lands, and frees the tap', () => {
    const step = answer(stateOf(), A, conflict);
    expect(step.state).toEqual(
      stateOf({ conflictPasses: 1, status: 'idle', inFlight: null, hold: 'ledger' }),
    );
    expect(step.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
  });

  it('fetches from the tip it holds, whatever current_seq says, or when it says nothing', () => {
    const step = answer(stateOf(), A, { kind: 'seqConflict', currentSeq: null });
    expect(step.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
    expect(answer(stateOf(), A, { kind: 'seqConflict', currentSeq: 40 }).effects).toEqual([
      { kind: 'fetchSince', seq: 4 },
    ]);
  });

  it('the second pass is counted and still only fetches', () => {
    const step = answer(stateOf({ conflictPasses: 1 }), A, conflict);
    expect(step.state.conflictPasses).toBe(2);
    expect(step.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
  });

  it('the third pass in a row fetches and waits 15 s, and the count starts again', () => {
    const step = answer(stateOf({ conflictPasses: 2 }), A, conflict);
    expect(step.state.conflictPasses).toBe(0);
    expect(step.state.status).toBe('idle');
    expect(step.state.notBefore).toBe(NOW + 15000);
    expect(step.effects).toEqual([
      { kind: 'fetchSince', seq: 4 },
      { kind: 'retryIn', ms: 15000 },
    ]);
  });

  it('the wait is kept by nextSend even after the fetch lands, and over once it is over', () => {
    const waited = answer(stateOf({ conflictPasses: 2 }), A, conflict).state;
    const fetched = onLedger(waited, []).state;
    expect(nextSend(fetched, NOW + 14999)).toBeNull();
    expect(nextSend(fetched, NOW + 15000)).toMatchObject({ idempotency_key: 'key-a' });
  });

  it('a pass that does not pause leaves a longer wait already set alone', () => {
    const step = answer(stateOf({ notBefore: NOW + 99_000 }), A, conflict);
    expect(step.state.notBefore).toBe(NOW + 99_000);
  });

  it('after the wait, the next conflict is the first pass again', () => {
    const waited = answer(stateOf({ conflictPasses: 2 }), A, conflict).state;
    const again = answer({ ...waited, status: 'sending' }, A, conflict);
    expect(again.state.conflictPasses).toBe(1);
    expect(again.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
  });

  it('three conflicts one after the other come to the wait, and no sooner', () => {
    let state = stateOf();
    const effects: (readonly string[])[] = [];
    for (let round = 0; round < 3; round += 1) {
      const step = answer({ ...state, status: 'sending' }, A, conflict);
      state = step.state;
      effects.push(step.effects.map((effect) => effect.kind));
    }
    expect(effects).toEqual([['fetchSince'], ['fetchSince'], ['fetchSince', 'retryIn']]);
  });

  it('the tap was not stored: its attempt goes back to 0 and the queue is saved first', () => {
    const waiting = tap('key-a', { attempts: 2 });
    const step = answer(stateOf({ queue: queueOf([waiting, B]) }), waiting, conflict);
    expect(step.state.queue.pending).toEqual([A, B]);
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 4 }]);
  });

  it('frees only the tap that was sent, and leaves the taps behind it with their counts', () => {
    const sent = tap('key-b', { attempts: 3 });
    const behind = tap('key-c', { attempts: 5 });
    const state = stateOf({ queue: queueOf([A, sent, behind]), inFlight: 'key-b' });
    const step = answer(state, sent, conflict);
    expect(step.state.queue.pending).toEqual([A, tap('key-b'), behind]);
    expect(step.state.inFlight).toBeNull();
  });

  it('leaves another tap’s in-flight mark alone', () => {
    expect(answer(stateOf({ inFlight: 'key-x' }), A, conflict).state.inFlight).toBe('key-x');
  });
});

describe('onAnswer: rulesChanged', () => {
  const changed: AppendAnswer = { kind: 'rulesChanged', rulesVersion: 3 };

  it('keeps the version it holds, every tap, holds for the rules, and asks for them', () => {
    const step = answer(stateOf(), A, changed);
    expect(step.state).toEqual(
      stateOf({
        rulesVersion: 2,
        status: 'idle',
        inFlight: null,
        hold: 'rules',
        rulesPasses: 1,
      }),
    );
    expect(step.effects).toEqual([{ kind: 'reloadRules' }]);
  });

  it('keeps the queue itself when no attempt needed freeing, so what is persisted does not change', () => {
    const state = stateOf();
    expect(answer(state, A, changed).state.queue).toBe(state.queue);
  });

  it('never lowers the version it holds, and does not take the named one before the rules come', () => {
    const step = answer(stateOf({ rulesVersion: 5 }), A, changed);
    expect(step.state.rulesVersion).toBe(5);
  });

  // The rules read that fails must not leave the phone believing it has the new rules: its next send names the old
  // version, the server answers FIXTURE_RULES_CHANGED again, and the phone asks again.
  it('a rules read that fails: the next send still carries the OLD version, so the server says so again', () => {
    const asked = answer(stateOf(), A, changed).state;
    const failed = onFetchFailed(asked, NOW);
    expect(failed.state.rulesVersion).toBe(2);
    expect(nextSend(failed.state, NOW + 5000)).toMatchObject({
      idempotency_key: 'key-a',
      rules_version: 2,
    });
    const resent = markSending(failed.state, NOW + 5000).state;
    const again = answer(resent, A, changed, NOW + 5000);
    expect(again.effects).toContainEqual({ kind: 'reloadRules' });
    expect(again.state.rulesPasses).toBe(2);
  });

  it('an accepted answer that names newer rules, and a rules read that fails, sends under the old version', () => {
    const asked = answer(stateOf(), A, accepted(5, 'ev-5', 3)).state;
    const failed = onFetchFailed(asked, NOW).state;
    expect(failed.rulesVersion).toBe(2);
    expect(nextSend(failed, NOW + 5000)).toMatchObject({
      idempotency_key: 'key-b',
      rules_version: 2,
    });
  });

  it('the rules that arrive are the version held from then on', () => {
    const asked = answer(stateOf(), A, changed).state;
    const taken = onRules(asked, { rulesVersion: 3 });
    expect(taken.rulesVersion).toBe(3);
  });

  it('the tap was not stored: its attempt goes back to 0 and the queue is saved first', () => {
    const waiting = tap('key-a', { attempts: 1 });
    const step = answer(stateOf({ queue: queueOf([waiting, B]) }), waiting, changed);
    expect(step.state.queue.pending).toEqual([A, B]);
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'reloadRules' }]);
  });

  it('three in a row reload and wait 15 s, and the count starts again', () => {
    const third = answer(stateOf({ rulesPasses: 2 }), A, changed);
    expect(third.state.rulesPasses).toBe(0);
    expect(third.state.notBefore).toBe(NOW + 15000);
    expect(third.effects).toEqual([{ kind: 'reloadRules' }, { kind: 'retryIn', ms: 15000 }]);
    const second = answer(stateOf({ rulesPasses: 1 }), A, changed);
    expect(second.state.rulesPasses).toBe(2);
    expect(second.effects).toEqual([{ kind: 'reloadRules' }]);
    expect(second.state.notBefore).toBe(0);
  });

  it('the count is its own: conflicts do not move it, and it does not move theirs', () => {
    const step = answer(stateOf({ conflictPasses: 2 }), A, changed);
    expect(step.state.conflictPasses).toBe(2);
    expect(step.state.rulesPasses).toBe(1);
  });

  it('the queue is sent again with the new rules version, after the rules came and it was looked at', () => {
    const asked = answer(stateOf(), A, changed).state;
    expect(nextSend(asked, NOW)).toBeNull();
    const taken = onRules(asked, { rulesVersion: 3 });
    expect(nextSend(taken, NOW)).toBeNull();
    const looked = revalidate(taken, (queued) => queued.map((q) => q.key)).state;
    expect(nextSend(looked, NOW)).toMatchObject({ idempotency_key: 'key-a', rules_version: 3 });
  });
});

describe('onRules', () => {
  it('takes a higher version and holds the queue until it is revalidated', () => {
    const next = onRules(restingOf({ hold: 'rules' }), { rulesVersion: 4 });
    expect(next.rulesVersion).toBe(4);
    expect(next.hold).toBe('revalidate');
  });

  it('an equal version keeps it, and the queue is still looked at once', () => {
    const next = onRules(restingOf({ hold: 'rules' }), { rulesVersion: 2 });
    expect(next.rulesVersion).toBe(2);
    expect(next.hold).toBe('revalidate');
  });

  it('a lower version never lowers it (a read lagging behind the answer that asked for it)', () => {
    const next = onRules(restingOf({ hold: 'rules', rulesVersion: 5 }), { rulesVersion: 3 });
    expect(next.rulesVersion).toBe(5);
    expect(next.hold).toBe('revalidate');
  });

  it('rules that came unasked hold the queue for revalidation too', () => {
    expect(onRules(restingOf(), { rulesVersion: 3 }).hold).toBe('revalidate');
  });

  it('a ledger fetch still owed stays owed: the rules do not release it, and the revalidation is owed too', () => {
    const next = onRules(restingOf({ hold: 'ledger' }), { rulesVersion: 3 });
    expect(next.hold).toBe('ledger');
    expect(next.revalidateOwed).toBe(true);
  });

  it('a status read still owed stays owed too', () => {
    const next = onRules(restingOf({ hold: 'status', decidedProbe: 'key-a' }), { rulesVersion: 3 });
    expect(next.hold).toBe('status');
    expect(next.decidedProbe).toBe('key-a');
    expect(next.revalidateOwed).toBe(true);
  });

  it('rules that land under a ledger hold are revalidated although the fetch brought nothing', () => {
    const owed = onRules(restingOf({ hold: 'ledger' }), { rulesVersion: 3 });
    const landed = onLedger(owed, []).state;
    expect(landed.hold).toBe('revalidate');
    expect(nextSend(landed, NOW)).toBeNull();
  });

  it('changes nothing but the version and the hold, and takes a whole Rules as it is', () => {
    const state = restingOf({ conflictPasses: 1, notBefore: NOW + 5 });
    const rules = { cfg: { any: 'thing' }, rulesVersion: 3, formatLine: null };
    expect(onRules(state, rules)).toEqual({ ...state, rulesVersion: 3, hold: 'revalidate' });
  });
});

describe('onAnswer: outdated (the app’s engine is behind)', () => {
  it('is Update needed: the queue kept and persisted, nothing more is sent', () => {
    const step = answer(stateOf(), A, { kind: 'outdated', required: 3 });
    expect(step.state).toEqual(stateOf({ status: 'outdated', inFlight: null }));
    expect(step.effects).toEqual([{ kind: 'persist' }]);
    expect(nextSend(step.state, NOW)).toBeNull();
  });

  it('the tap was not stored: its attempt goes back to 0', () => {
    const waiting = tap('key-a', { attempts: 2 });
    const step = answer(stateOf({ queue: queueOf([waiting, B]) }), waiting, {
      kind: 'outdated',
      required: 3,
    });
    expect(step.state.queue.pending).toEqual([A, B]);
  });
});

describe('onAnswer: linkDead', () => {
  it.each(['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED'] as const)(
    '%s: the queue is marked dead and persisted, the taps kept',
    (code) => {
      const step = answer(stateOf(), A, { kind: 'linkDead', code });
      expect(step.state).toEqual(
        stateOf({ status: 'dead', inFlight: null, queue: queueOf([A, B], { dead: code }) }),
      );
      expect(step.effects).toEqual([{ kind: 'persist' }]);
    },
  );
});

// Review Focus 4: the link revoked with taps queued.
describe('a revoked link with taps queued (Review Focus 4)', () => {
  const dead = () => answer(stateOf(), A, { kind: 'linkDead', code: 'LINK_REVOKED' }).state;

  it('nothing is sent anywhere else: no body, no mark, no send effect', () => {
    expect(nextSend(dead(), NOW)).toBeNull();
    const state = dead();
    expect(markSending(state, NOW).state).toBe(state);
    expect(markSending(dead(), NOW).state.status).toBe('dead');
  });

  it('the taps stay as leftovers, whatever else arrives', () => {
    const fetched = onLedger(dead(), [ev(5)]).state;
    expect(fetched.queue.pending).toEqual([A, B]);
    expect(fetched.queue.dead).toBe('LINK_REVOKED');
    expect(fetched.status).toBe('dead');
  });

  it('a later accepted answer does not bring the queue back to life', () => {
    const step = answer(dead(), B, accepted(5, 'ev-5'));
    expect(step.state.queue.dead).toBe('LINK_REVOKED');
    expect(step.state.status).toBe('dead');
    expect(step.effects.map((effect) => effect.kind)).not.toContain('send');
  });

  it.each([
    ['accepted', accepted(5, 'ev-5')],
    ['seqConflict', { kind: 'seqConflict', currentSeq: 6 } as AppendAnswer],
    ['rulesChanged', { kind: 'rulesChanged', rulesVersion: 3 } as AppendAnswer],
    ['rateLimited', { kind: 'rateLimited', retryAfterMs: 1000 } as AppendAnswer],
    ['a refusal', refusal('WRONG_PHASE')],
    ['ALREADY_DECIDED', refusal('ALREADY_DECIDED')],
  ])('a late %s answer leaves a dead queue dead, status and all', (_name, said) => {
    const gone = stateOf({
      status: 'dead',
      queue: queueOf([A, B], { dead: 'LINK_REVOKED' }),
    });
    const step = answer(gone, A, said);
    expect(step.state.queue.dead).toBe('LINK_REVOKED');
    expect(step.state.status).toBe('dead');
    expect(step.effects.map((effect) => effect.kind)).not.toContain('send');
  });
});

describe('onAnswer: rateLimited', () => {
  it('waits as long as it was told, changing nothing else but the wait and the tap’s freedom', () => {
    const step = answer(stateOf(), A, { kind: 'rateLimited', retryAfterMs: 7000 });
    expect(step.state).toEqual(stateOf({ status: 'idle', inFlight: null, notBefore: NOW + 7000 }));
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 7000 }]);
  });

  it('nextSend honours the wait to the millisecond', () => {
    const state = answer(stateOf(), A, { kind: 'rateLimited', retryAfterMs: 7000 }).state;
    expect(nextSend(state, NOW + 6999)).toBeNull();
    expect(nextSend(state, NOW + 7000)).toMatchObject({ idempotency_key: 'key-a' });
  });

  // The web rate-limits before its durable replay, so a 429 does not say the tap was never stored.
  it('keeps the tap’s attempts: a 429 does not prove the server never took it', () => {
    const waiting = tap('key-a', { attempts: 1 });
    const step = answer(stateOf({ queue: queueOf([waiting, B]) }), waiting, {
      kind: 'rateLimited',
      retryAfterMs: 1000,
    });
    expect(step.state.queue.pending).toEqual([waiting, B]);
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 1000 }]);
    expect(isUnresolved(step.state, 'key-a')).toBe(true);
    expect(canDiscardQueued(step.state, 'key-a')).toBe(false);
  });
});

describe('onAnswer: offline', () => {
  const offline: AppendAnswer = { kind: 'offline' };
  const sentOnce = tap('key-a', { attempts: 1 });

  it('is offline and retries in 1 s after the first send; the attempt was counted when it went', () => {
    const state = stateOf({ queue: queueOf([sentOnce, B]) });
    const step = answer(state, sentOnce, offline);
    expect(step.state).toEqual(
      stateOf({
        status: 'offline',
        inFlight: null,
        notBefore: NOW + 1000,
        queue: queueOf([sentOnce, B]),
      }),
    );
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 1000 }]);
  });

  // the attempts the tap has made, this one included -> the wait before the next one, from the plan's table
  it.each([
    [1, 1000],
    [2, 2000],
    [3, 5000],
    [4, 10000],
    [5, 15000],
    [6, 15000],
    [40, 15000],
  ] as const)(
    'after %i attempts counted, the next wait is %i ms, and no send comes sooner',
    (attempts, ms) => {
      const sent = tap('key-a', { attempts });
      const step = answer(stateOf({ queue: queueOf([sent, B]) }), sent, offline);
      expect(step.effects).toEqual([{ kind: 'retryIn', ms }]);
      expect(step.state.queue.pending[0]?.attempts).toBe(attempts);
      expect(nextSend(step.state, NOW + ms - 1)).toBeNull();
      expect(nextSend(step.state, NOW + ms)).toMatchObject({ idempotency_key: 'key-a' });
    },
  );

  it('an answer for a tap nobody marked (no attempt counted) still waits the first 1 s', () => {
    const step = answer(stateOf(), A, offline);
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 1000 }]);
    expect(step.state.queue.pending[0]?.attempts).toBe(0);
  });

  it('counts nothing more: the same answer twice leaves one attempt, and the others are not tried', () => {
    const state = stateOf({ queue: queueOf([sentOnce, B]) });
    const once = answer(state, sentOnce, offline);
    const twice = answer(once.state, sentOnce, offline);
    expect(twice.state.queue.pending).toEqual([sentOnce, B]);
  });

  it('keeps the same key for the retry, so a tap the server took is not counted twice', () => {
    const step = answer(stateOf({ queue: queueOf([sentOnce, B]) }), sentOnce, offline);
    expect(nextSend(step.state, NOW + 1000)?.idempotency_key).toBe('key-a');
  });

  it('the tap stays unresolved: it may be in the ledger, so only a resend’s answer settles it', () => {
    const step = answer(stateOf({ queue: queueOf([sentOnce, B]) }), sentOnce, offline);
    expect(isUnresolved(step.state, 'key-a')).toBe(true);
    expect(canDiscardQueued(step.state, 'key-a')).toBe(false);
  });

  it('a tap that left the queue meanwhile leaves the queue as it is', () => {
    const state = stateOf({ queue: queueOf([B]), inFlight: null });
    const step = answer(state, A, offline);
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 1000 }]);
  });
});

describe('onAnswer: refused (one tap)', () => {
  it('drops the tap, says so, fetches the ledger again, and persists', () => {
    const step = answer(stateOf(), A, refusal('WRONG_PHASE'));
    expect(step.state).toEqual(stateOf({ status: 'idle', inFlight: null, queue: queueOf([B]) }));
    expect(step.effects).toEqual([
      { kind: 'refused', key: 'key-a', code: 'WRONG_PHASE' },
      { kind: 'fetchSince', seq: 4 },
      { kind: 'persist' },
    ]);
  });

  // The engine's own words, as the web answers them (apps/web/src/server/api-v1/http.ts): one tap is refused, the
  // queue goes on with the next.
  it.each([
    [400, 'VALIDATION'],
    [422, 'INVALID_EVENT'],
    [422, 'WRONG_PHASE'],
    [422, 'ENDING_SANCTION_PENDING'],
    [409, 'SETTLE_NOT_APPLICABLE'],
  ] as const)('%i %s refuses that tap alone, and the queue is not dead', (status, code) => {
    const step = answer(stateOf(), A, refusal(code, status));
    expect(step.state.queue.dead).toBeNull();
    expect(step.state.status).toBe('idle');
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects[0]).toEqual({ kind: 'refused', key: 'key-a', code });
    expect(nextSend(step.state, NOW)).toMatchObject({ idempotency_key: 'key-b' });
  });

  it('a revalidation owed is done before the next tap goes, when there is a next tap', () => {
    const tried = tap('key-a', { attempts: 1 });
    const state = stateOf({ queue: queueOf([tried, B]), revalidateOwed: true });
    expect(answer(state, tried, refusal('WRONG_PHASE')).state.hold).toBe('revalidate');
    const alone = stateOf({ queue: queueOf([tried]), revalidateOwed: true });
    expect(answer(alone, tried, refusal('WRONG_PHASE')).state.hold).toBeNull();
    expect(answer(stateOf(), A, refusal('WRONG_PHASE')).state.hold).toBeNull();
  });

  it('passes the server’s code on as it is', () => {
    const step = answer(stateOf(), A, refusal('INVALID_EVENT'));
    expect(step.effects[0]).toEqual({ kind: 'refused', key: 'key-a', code: 'INVALID_EVENT' });
  });

  it('drops only the tap that was refused', () => {
    const state = stateOf({ queue: queueOf([A, B, C]), inFlight: 'key-b' });
    const step = answer(state, B, refusal('INVALID_EVENT'));
    expect(step.state.queue.pending).toEqual([A, C]);
    expect(step.state.inFlight).toBeNull();
  });

  it('counts nothing as the phone’s own, and moves neither tip nor ledger', () => {
    const step = answer(stateOf(), A, refusal('WRONG_PHASE'));
    expect(step.state.queue.ownEventIds).toEqual([]);
    expect(step.state.tip).toBe(4);
    expect(step.state.ledger).toEqual(stateOf().ledger);
  });
});

describe('onAnswer: refused (the whole queue)', () => {
  // status, the server's code -> the word the queue dies with
  it.each([
    [401, 'UNAUTHENTICATED', 'LINK_INVALID'],
    [402, 'PAYMENT_REQUIRED', 'payment'],
    [403, 'FORBIDDEN', 'forbidden'],
    [403, 'RESULT_CARRIED_FORWARD', 'finalized'],
    [404, 'NOT_FOUND', 'gone'],
  ] as const)(
    '%i %s: the queue is dead (%s), the taps kept, nothing more is sent',
    (status, code, word) => {
      const step = answer(stateOf(), A, refusal(code, status));
      expect(step.state).toEqual(
        stateOf({ status: 'dead', inFlight: null, queue: queueOf([A, B], { dead: word }) }),
      );
      expect(step.effects).toEqual([{ kind: 'persist' }]);
      expect(nextSend({ ...step.state, status: 'idle' }, NOW)).toBeNull();
    },
  );

  it('says no tap was refused: they are leftovers, not lost', () => {
    const step = answer(stateOf(), A, refusal('FORBIDDEN', 403));
    expect(step.effects.map((effect) => effect.kind)).not.toContain('refused');
  });

  it('a 403 that is not the carried-forward result is forbidden, never finalized', () => {
    const step = answer(stateOf(), A, refusal('SOMETHING_ELSE', 403));
    expect(step.state.queue.dead).toBe('forbidden');
  });

  // The web's own words for a write this link may not make (usecases/scoring.ts): an organiser-only forfeit, and a
  // device link's void of an event that is not its own or of a finalized fixture: one tap, not the queue.
  it.each(['core.void', 'core.forfeit'] as const)(
    'a bare 403 answering %s refuses that tap alone: the queue goes on',
    (type) => {
      const sent = tap('key-v', {
        type,
        payload: type === 'core.void' ? { event_id: 'ev-2' } : {},
      });
      const step = answer(
        stateOf({ queue: queueOf([sent, B]), inFlight: 'key-v' }),
        sent,
        refusal('FORBIDDEN', 403),
      );
      expect(step.state.queue.dead).toBeNull();
      expect(step.state.queue.pending).toEqual([B]);
      expect(step.effects[0]).toEqual({ kind: 'refused', key: 'key-v', code: 'FORBIDDEN' });
    },
  );

  it('a 403 answering any other tap still closes the queue', () => {
    expect(answer(stateOf(), A, refusal('FORBIDDEN', 403)).state.queue.dead).toBe('forbidden');
  });

  it('a void’s 403 that is the carried-forward result still closes the queue: the match is finalized', () => {
    const sent = tap('key-v', { type: 'core.void', payload: { event_id: 'ev-2' } });
    const step = answer(
      stateOf({ queue: queueOf([sent, B]), inFlight: 'key-v' }),
      sent,
      refusal('RESULT_CARRIED_FORWARD', 403),
    );
    expect(step.state.queue.dead).toBe('finalized');
  });

  it('a 422 with a 403’s word is still one tap: the status decides first', () => {
    const step = answer(stateOf(), A, refusal('RESULT_CARRIED_FORWARD', 422));
    expect(step.state.queue.dead).toBeNull();
  });
});

// The match's own status (the bootstrap's) says whether the match is closed. The ledger cannot: a staff reopen leaves
// an active core.finalize in it, and a cancelled match shows nothing there at all.
describe('onAnswer: ALREADY_DECIDED (the match is decided or closed)', () => {
  const decided = () => answer(stateOf(), A, refusal('ALREADY_DECIDED'));

  it('holds the head, asks for the match’s status once, and says nothing is refused yet', () => {
    const step = decided();
    expect(step.state).toEqual(
      stateOf({
        status: 'idle',
        inFlight: null,
        hold: 'status',
        decidedProbe: 'key-a',
        queue: queueOf([A, B]),
      }),
    );
    expect(step.effects).toEqual([{ kind: 'reloadBootstrap' }]);
    expect(nextSend(step.state, NOW)).toBeNull();
  });

  it('is the code’s business, not the status’s', () => {
    const step = answer(stateOf(), A, refusal('ALREADY_DECIDED', 409));
    expect(step.state.decidedProbe).toBe('key-a');
  });

  it.each([
    ['finalized', 'finalized'],
    ['cancelled', 'cancelled'],
  ] as const)('a status that says %s kills the queue (%s), every tap kept', (status, word) => {
    const step = onBootstrapStatus(decided().state, status);
    expect(step.state.status).toBe('dead');
    expect(step.state.queue.dead).toBe(word);
    expect(step.state.queue.pending).toEqual([A, B]);
    expect(step.state.decidedProbe).toBeNull();
    expect(step.state.hold).toBeNull();
    expect(step.effects).toEqual([{ kind: 'persist' }]);
    expect(nextSend({ ...step.state, status: 'idle' }, NOW)).toBeNull();
  });

  it('a lock in the ledger that a staff reopen left is no lock: the status decides, and the tap is refused', () => {
    const locked = stateOf({
      tip: 5,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5, { type: 'core.finalize', payload: {} })],
    });
    const held = answer(locked, A, refusal('ALREADY_DECIDED')).state;
    const step = onBootstrapStatus(held, 'in_play');
    expect(step.state.queue.dead).toBeNull();
    expect(step.effects[0]).toEqual({ kind: 'refused', key: 'key-a', code: 'ALREADY_DECIDED' });
  });

  it.each([
    'decided',
    'in_play',
    'scheduled',
    'forfeited',
    'abandoned',
    'needs_decision',
    'unheard-of',
  ])(
    'a status that says %s refuses that tap alone, fetches the ledger, and has the queue looked at',
    (status) => {
      const step = onBootstrapStatus(decided().state, status);
      expect(step.state.queue.dead).toBeNull();
      expect(step.state.queue.pending).toEqual([B]);
      expect(step.state.decidedProbe).toBeNull();
      expect(step.state.hold).toBe('revalidate');
      expect(step.effects).toEqual([
        { kind: 'refused', key: 'key-a', code: 'ALREADY_DECIDED' },
        { kind: 'fetchSince', seq: 4 },
        { kind: 'persist' },
      ]);
    },
  );

  it('the next tap goes once the status answered, and the revalidation has run', () => {
    const refused = onBootstrapStatus(decided().state, 'decided').state;
    expect(nextSend(refused, NOW)).toBeNull();
    const looked = revalidate(refused, (queued) => queued.map((q) => q.key)).state;
    expect(nextSend(looked, NOW)).toMatchObject({ idempotency_key: 'key-b', expected_seq: 4 });
  });

  it('a held tap that is no longer queued is not refused twice, and the hold is let go', () => {
    const held = { ...decided().state, queue: queueOf([B]) };
    const step = onBootstrapStatus(held, 'decided');
    expect(step.effects).toEqual([]);
    expect(step.state.decidedProbe).toBeNull();
    expect(step.state.hold).toBe('revalidate');
  });

  it('with nothing queued behind a gone tap, the hold is simply let go', () => {
    const held = { ...decided().state, queue: queueOf([]) };
    expect(onBootstrapStatus(held, 'decided').state.hold).toBeNull();
  });

  it('a status read with no answer waiting on it refuses nothing', () => {
    const state = restingOf();
    const step = onBootstrapStatus(state, 'in_play');
    expect(step.effects).toEqual([]);
    expect(step.state).toEqual(state);
  });

  it('a status read unasked does not release another hold', () => {
    const state = restingOf({ hold: 'rules' });
    expect(onBootstrapStatus(state, 'in_play').state.hold).toBe('rules');
  });

  it.each(['finalized', 'cancelled'] as const)(
    'a %s status read unasked, with taps queued, kills the queue too',
    (status) => {
      const step = onBootstrapStatus(restingOf(), status);
      expect(step.state.queue.dead).toBe(status);
      expect(step.state.status).toBe('dead');
      expect(step.effects).toEqual([{ kind: 'persist' }]);
    },
  );

  it.each(['finalized', 'cancelled'] as const)(
    'a %s status read with nothing queued has no queue to kill',
    (status) => {
      const state = restingOf({ queue: queueOf([]) });
      const step = onBootstrapStatus(state, status);
      expect(step.state.queue.dead).toBeNull();
      expect(step.effects).toEqual([]);
    },
  );

  it('a ledger fetch landing meanwhile does not release the hold: the head waits for the status', () => {
    const held = decided().state;
    const step = onLedger(held, [ev(5)]);
    expect(step.state.hold).toBe('status');
    expect(step.state.decidedProbe).toBe('key-a');
    expect(nextSend(step.state, NOW)).toBeNull();
  });

  it('a status read that never lands lets the head go again, and its next ALREADY_DECIDED asks again', () => {
    const failed = onFetchFailed(decided().state, NOW);
    expect(failed.state.decidedProbe).toBeNull();
    expect(failed.state.hold).toBeNull();
    expect(failed.effects).toEqual([{ kind: 'retryIn', ms: 5000 }]);
    expect(nextSend(failed.state, NOW + 5000)).toMatchObject({ idempotency_key: 'key-a' });
    const resent = { ...failed.state, status: 'sending' as const, inFlight: 'key-a' };
    const again = answer(resent, A, refusal('ALREADY_DECIDED'));
    expect(again.effects).toEqual([{ kind: 'reloadBootstrap' }]);
    expect(again.state.decidedProbe).toBe('key-a');
  });
});

describe('onReadFailed', () => {
  const held = (hold: 'ledger' | 'rules' | 'status') => restingOf({ hold });

  it.each([['LINK_INVALID'], ['LINK_REVOKED'], ['LINK_EXPIRED']] as const)(
    'a read answered %s makes the queue dead, the taps kept, and saves it',
    (code) => {
      const asking = restingOf({ hold: 'status', decidedProbe: 'key-a' });
      const step = onReadFailed(asking, { kind: 'linkDead', code }, NOW);
      expect(step.state.decidedProbe).toBeNull();
      expect(step.state.status).toBe('dead');
      expect(step.state.queue.dead).toBe(code);
      expect(step.state.queue.pending).toEqual([A, B]);
      expect(step.state.hold).toBeNull();
      expect(step.effects).toEqual([{ kind: 'persist' }]);
      expect(nextSend({ ...step.state, status: 'idle' }, NOW)).toBeNull();
    },
  );

  it.each([
    [401, 'UNAUTHENTICATED', 'LINK_INVALID'],
    [402, 'PAYMENT_REQUIRED', 'payment'],
    [403, 'FORBIDDEN', 'forbidden'],
    [403, 'RESULT_CARRIED_FORWARD', 'finalized'],
    [404, 'NOT_FOUND', 'gone'],
  ] as const)('a read refused %i %s closes the queue (%s)', (status, code, word) => {
    const step = onReadFailed(restingOf(), { kind: 'refused', status, code }, NOW);
    expect(step.state.queue.dead).toBe(word);
    expect(step.effects).toEqual([{ kind: 'persist' }]);
  });

  it('with nothing queued there is no queue to close: the same state', () => {
    const state = restingOf({ queue: queueOf([]) });
    const step = onReadFailed(state, { kind: 'linkDead', code: 'LINK_REVOKED' }, NOW);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
  });

  it('a refusal that is about no queue is a read that did not land: the hold is let go, the same wait', () => {
    const step = onReadFailed(
      held('ledger'),
      { kind: 'refused', status: 422, code: 'WRONG_PHASE' },
      NOW,
    );
    expect(step.state.queue.dead).toBeNull();
    expect(step.state.hold).toBeNull();
    expect(step.state.notBefore).toBe(NOW + 5000);
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 5000 }]);
  });

  it('offline is a read that did not land, whichever read it was', () => {
    for (const hold of ['ledger', 'rules', 'status'] as const) {
      const step = onReadFailed(held(hold), { kind: 'offline' }, NOW);
      expect(step.state.hold).toBeNull();
      expect(step.effects).toEqual([{ kind: 'retryIn', ms: 5000 }]);
    }
  });

  it('a throttled read waits as long as it was told, and lets its hold go', () => {
    const step = onReadFailed(held('ledger'), { kind: 'rateLimited', retryAfterMs: 9000 }, NOW);
    expect(step.state.hold).toBeNull();
    expect(step.state.notBefore).toBe(NOW + 9000);
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 9000 }]);
    expect(nextSend(step.state, NOW + 8999)).toBeNull();
    expect(nextSend(step.state, NOW + 9000)).not.toBeNull();
  });

  it('a read of a match too long for this build is a visible state, and nothing is retried or sent', () => {
    const step = onReadFailed(held('ledger'), { kind: 'tooLarge' }, NOW);
    expect(step.state.status).toBe('tooLarge');
    expect(step.state.hold).toBeNull();
    expect(step.state.queue.pending).toEqual([A, B]);
    expect(step.effects).toEqual([]);
    expect(nextSend(step.state, NOW + 1_000_000)).toBeNull();
    expect(markSending(step.state, NOW + 1_000_000).state).toBe(step.state);
  });

  it('a read that says the app is out of date is Update needed', () => {
    const step = onReadFailed(restingOf(), { kind: 'outdated', required: 3 }, NOW);
    expect(step.state.status).toBe('outdated');
    expect(nextSend(step.state, NOW)).toBeNull();
  });

  it('a read cannot be answered with a conflict: it is a read that did not land', () => {
    const step = onReadFailed(held('rules'), { kind: 'seqConflict', currentSeq: null }, NOW);
    expect(step.state.hold).toBeNull();
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 5000 }]);
    const rules = onReadFailed(held('rules'), { kind: 'rulesChanged', rulesVersion: 9 }, NOW);
    expect(rules.state.hold).toBeNull();
  });

  it('with no hold, a read that did not land changes nothing', () => {
    const state = restingOf();
    const step = onReadFailed(state, { kind: 'offline' }, NOW);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
  });
});

describe('onFetchFailed', () => {
  it.each(['ledger', 'rules', 'status'] as const)(
    'lets go of a %s hold, and waits 5 s before sending on what is held',
    (hold) => {
      const step = onFetchFailed(restingOf({ hold }), NOW);
      expect(step.state.hold).toBeNull();
      expect(step.state.notBefore).toBe(NOW + 5000);
      expect(step.effects).toEqual([{ kind: 'retryIn', ms: 5000 }]);
      expect(nextSend(step.state, NOW + 4999)).toBeNull();
      expect(nextSend(step.state, NOW + 5000)).not.toBeNull();
    },
  );

  it('a revalidation still owed is not lost with the hold: the queue is looked at before it goes', () => {
    const step = onFetchFailed(restingOf({ hold: 'ledger', revalidateOwed: true }), NOW);
    expect(step.state.hold).toBe('revalidate');
    expect(nextSend(step.state, NOW + 5000)).toBeNull();
  });

  it('never shortens a wait already set', () => {
    const step = onFetchFailed(restingOf({ hold: 'ledger', notBefore: NOW + 15000 }), NOW);
    expect(step.state.notBefore).toBe(NOW + 15000);
  });

  it.each([null, 'revalidate'] as const)(
    'with a %s hold there is no fetch to lose: the same state',
    (hold) => {
      const state = restingOf({ hold });
      const step = onFetchFailed(state, NOW);
      expect(step.state).toBe(state);
      expect(step.effects).toEqual([]);
    },
  );

  it('a stuck phone heals itself: a failed fetch, then a conflict, asks again at the pace the passes set', () => {
    const conflicted = answer(stateOf(), A, { kind: 'seqConflict', currentSeq: 6 }).state;
    const failed = onFetchFailed(conflicted, NOW).state;
    const sending = markSending(failed, NOW + 5000).state;
    expect(sending.status).toBe('sending');
    const again = answer(sending, A, { kind: 'seqConflict', currentSeq: 6 }, NOW + 5000);
    expect(again.state.conflictPasses).toBe(2);
    expect(again.effects.map((effect) => effect.kind)).toContain('fetchSince');
  });
});

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
    expect(refused.state.hold).toBe('revalidate');
    const judged = revalidate(refused.state, legalAfterForfeit(refused.state));
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
    expect(step.state.hold).toBe('revalidate');
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
