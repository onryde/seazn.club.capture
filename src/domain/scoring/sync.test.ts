import { describe, expect, it, vi } from 'vitest';
import type { MatchQueue, QueuedEvent } from '@/domain/scoring/queue';
import {
  markSending,
  nextSend,
  NO_LONGER_LEGAL,
  onAnswer,
  onLedger,
  revalidate,
  type SyncState,
} from '@/domain/scoring/sync';
import type { AppendAnswer, LedgerEvent } from '@/domain/scoring/wire';

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

const stateOf = (overrides: Partial<SyncState> = {}): SyncState => ({
  tip: 4,
  ledger: [ev(1), ev(2), ev(3), ev(4)],
  queue: queueOf([A, B]),
  rulesVersion: 2,
  engineEpoch: 2,
  status: 'sending',
  conflictPasses: 0,
  ...overrides,
});

const accepted = (seq: number, eventId: string): AppendAnswer => ({
  kind: 'accepted',
  seq,
  eventId,
  rulesVersion: 2,
});

describe('nextSend', () => {
  it('is the head of the queue, at the tip, with the epoch and the rules version', () => {
    expect(nextSend(stateOf({ status: 'idle' }))).toEqual({
      expected_seq: 4,
      type: 'badminton.rally',
      payload: { wonBy: 'ent-home' },
      idempotency_key: 'key-a',
      engine_epoch: 2,
      rules_version: 2,
    });
  });

  it('sends under the rules the phone holds now, not the ones the tap was made under', () => {
    const body = nextSend(stateOf({ status: 'idle', rulesVersion: 3, queue: queueOf([A]) }));
    expect(body?.rules_version).toBe(3);
  });

  it('sends the tip as it moves', () => {
    expect(nextSend(stateOf({ status: 'idle', tip: 9 }))?.expected_seq).toBe(9);
  });

  it('sends any event type with its payload as it was tapped', () => {
    const start = tap('key-s', { type: 'core.start', payload: {} });
    const sanction = tap('key-z', {
      type: 'badminton.sanction',
      payload: { by: 'ent-away', level: 'warning' },
    });
    expect(nextSend(stateOf({ status: 'idle', queue: queueOf([start]) }))).toMatchObject({
      type: 'core.start',
      payload: {},
    });
    expect(nextSend(stateOf({ status: 'idle', queue: queueOf([sanction]) }))).toMatchObject({
      type: 'badminton.sanction',
      payload: { by: 'ent-away', level: 'warning' },
    });
  });

  it('is null with nothing queued', () => {
    expect(nextSend(stateOf({ status: 'idle', queue: queueOf([]) }))).toBeNull();
  });

  it('is null while one is in flight: one at a time', () => {
    expect(nextSend(stateOf({ status: 'sending' }))).toBeNull();
  });

  it('is the head again after offline: a retry is the same tap, with the same key', () => {
    expect(nextSend(stateOf({ status: 'offline' }))?.idempotency_key).toBe('key-a');
  });

  it('is null while the app is Update needed', () => {
    expect(nextSend(stateOf({ status: 'outdated' }))).toBeNull();
  });

  it('is null once the link is dead', () => {
    expect(nextSend(stateOf({ status: 'dead' }))).toBeNull();
  });

  it.each(['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED', 'finalized'] as const)(
    'is null for a queue read back from disk already dead (%s): nothing is sent anywhere',
    (dead) => {
      expect(nextSend(stateOf({ status: 'idle', queue: queueOf([A, B], { dead }) }))).toBeNull();
    },
  );
});

describe('markSending', () => {
  it('moves idle and offline to sending when there is something to send', () => {
    expect(markSending(stateOf({ status: 'idle' })).status).toBe('sending');
    expect(markSending(stateOf({ status: 'offline' })).status).toBe('sending');
  });

  it.each(['sending', 'outdated', 'dead'] as const)('leaves %s as it is', (status) => {
    const state = stateOf({ status });
    expect(markSending(state)).toBe(state);
  });

  it('leaves an empty queue idle, and a dead queue where it is', () => {
    const empty = stateOf({ status: 'idle', queue: queueOf([]) });
    expect(markSending(empty)).toBe(empty);
    const dead = stateOf({ status: 'idle', queue: queueOf([A], { dead: 'LINK_REVOKED' }) });
    expect(markSending(dead)).toBe(dead);
  });
});

describe('onAnswer: accepted', () => {
  it('moves the head into the ledger and the own ids, moves the tip, and sends the next', () => {
    const step = onAnswer(stateOf(), A, accepted(5, 'ev-5'));
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
        queue: queueOf([B], { ownEventIds: ['ev-5'] }),
        status: 'sending',
      }),
    );
    expect(step.effects).toEqual([
      { kind: 'persist' },
      {
        kind: 'send',
        body: {
          expected_seq: 5,
          type: 'badminton.rally',
          payload: { wonBy: 'ent-away' },
          idempotency_key: 'key-b',
          engine_epoch: 2,
          rules_version: 2,
        },
      },
    ]);
  });

  it('with nothing behind it, persists and is idle', () => {
    const step = onAnswer(stateOf({ queue: queueOf([A]) }), A, accepted(5, 'ev-5'));
    expect(step.state.status).toBe('idle');
    expect(step.state.queue.pending).toEqual([]);
    expect(step.effects).toEqual([{ kind: 'persist' }]);
  });

  it('drains a queue in order, each send at the tip the last answer left', () => {
    const first = onAnswer(stateOf(), A, accepted(5, 'ev-5'));
    const second = onAnswer(first.state, B, accepted(6, 'ev-6'));
    expect(second.state.tip).toBe(6);
    expect(second.state.queue).toEqual(queueOf([], { ownEventIds: ['ev-5', 'ev-6'] }));
    expect(second.state.ledger.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(second.effects).toEqual([{ kind: 'persist' }]);
  });

  it('keeps the own ids it had, in order', () => {
    const state = stateOf({ queue: queueOf([A], { ownEventIds: ['ev-0'] }) });
    expect(onAnswer(state, A, accepted(5, 'ev-5')).state.queue.ownEventIds).toEqual([
      'ev-0',
      'ev-5',
    ]);
  });

  it('records a void as voiding the event its payload names', () => {
    const state = stateOf({ queue: queueOf([C]) });
    const joined = onAnswer(state, C, accepted(5, 'ev-5')).state.ledger[4];
    expect(joined).toMatchObject({ id: 'ev-5', type: 'core.void', voids: 'ev-2' });
  });

  it('records a void with no event id in its payload as voiding nothing', () => {
    const odd = tap('key-o', { type: 'core.void', payload: { event_id: 7 } });
    const none = tap('key-n', { type: 'core.void', payload: null });
    const first = onAnswer(stateOf({ queue: queueOf([odd]) }), odd, accepted(5, 'ev-5'));
    const second = onAnswer(stateOf({ queue: queueOf([none]) }), none, accepted(5, 'ev-5'));
    expect(first.state.ledger[4]?.voids).toBeNull();
    expect(second.state.ledger[4]?.voids).toBeNull();
  });

  it('does not take a rally for a void, whatever its payload says', () => {
    const rally = tap('key-r', { payload: { event_id: 'ev-2' } });
    const joined = onAnswer(stateOf({ queue: queueOf([rally]) }), rally, accepted(5, 'ev-5'));
    expect(joined.state.ledger[4]?.voids).toBeNull();
  });

  it('is progress: the conflict count starts again and an offline phone is online', () => {
    const state = stateOf({ conflictPasses: 2, status: 'sending' });
    expect(onAnswer(state, A, accepted(5, 'ev-5')).state.conflictPasses).toBe(0);
  });

  it('leaves the queued events behind it as they were, attempts and all', () => {
    const waiting = tap('key-b', { attempts: 3 });
    const step = onAnswer(stateOf({ queue: queueOf([A, waiting]) }), A, accepted(5, 'ev-5'));
    expect(step.state.queue.pending).toEqual([waiting]);
  });

  it('a seq it cannot place is counted, and the gap is fetched before anything else is sent', () => {
    const step = onAnswer(stateOf(), A, accepted(9, 'ev-9'));
    expect(step.state.tip).toBe(4);
    expect(step.state.ledger).toEqual(stateOf().ledger);
    expect(step.state.queue).toEqual(queueOf([B], { ownEventIds: ['ev-9'] }));
    expect(step.state.status).toBe('idle');
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 4 }]);
  });

  it('an answer for a tap that left the queue meanwhile (undone in flight) is still the server’s event', () => {
    const step = onAnswer(stateOf({ queue: queueOf([B]) }), A, accepted(5, 'ev-5'));
    expect(step.state.queue).toEqual(queueOf([B], { ownEventIds: ['ev-5'] }));
    expect(step.state.ledger.map((e) => e.id)).toEqual(['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5']);
    expect(step.state.tip).toBe(5);
  });
});

// Review Focus 2: the answer lost after the server accepted.
describe('onAnswer: a replayed accept counts once (Review Focus 2)', () => {
  it('the resend after a lost answer is answered with the original event id: one own id, one ledger event', () => {
    const lost = stateOf({ status: 'offline', queue: queueOf([tap('key-a', { attempts: 1 })]) });
    const step = onAnswer(lost, tap('key-a', { attempts: 1 }), accepted(5, 'ev-5'));
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
    const step = onAnswer(fetched, A, accepted(5, 'ev-5'));
    expect(step.state.ledger).toHaveLength(5);
    expect(step.state.ledger[4]).toEqual(ev(5, { deviceLinkId: 'link-this-phone' }));
    expect(step.state.queue).toEqual(queueOf([B], { ownEventIds: ['ev-5'] }));
    expect(step.state.tip).toBe(5);
    expect(step.state.status).toBe('sending');
    expect(step.effects).toEqual([
      { kind: 'persist' },
      {
        kind: 'send',
        body: {
          expected_seq: 5,
          type: 'badminton.rally',
          payload: { wonBy: 'ent-away' },
          idempotency_key: 'key-b',
          engine_epoch: 2,
          rules_version: 2,
        },
      },
    ]);
  });

  it('another scorer’s event at that seq is not the tap: counted as the server’s, and a fetch follows', () => {
    const other = stateOf({
      tip: 5,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5, { id: 'ev-other-5' })],
    });
    const step = onAnswer(other, A, accepted(5, 'ev-5'));
    expect(step.state.ledger).toEqual([ev(1), ev(2), ev(3), ev(4), ev(5, { id: 'ev-other-5' })]);
    expect(step.state.queue).toEqual(queueOf([B], { ownEventIds: ['ev-5'] }));
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 5 }]);
  });

  it('a replay that names a seq behind the tip never moves the tip back', () => {
    const behind = stateOf({
      tip: 7,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5), ev(6), ev(7)],
    });
    expect(onAnswer(behind, A, accepted(5, 'ev-5')).state.tip).toBe(7);
  });

  it('the same answer delivered twice is the same as once, and sends nothing twice', () => {
    const once = onAnswer(stateOf(), A, accepted(5, 'ev-5'));
    const twice = onAnswer(once.state, A, accepted(5, 'ev-5'));
    expect(twice.state).toBe(once.state);
    expect(twice.effects).toEqual([]);
  });
});

describe('onAnswer: seqConflict', () => {
  const conflict: AppendAnswer = { kind: 'seqConflict', currentSeq: 6 };

  it('counts a pass and fetches from the tip, the queue as it was', () => {
    const step = onAnswer(stateOf(), A, conflict);
    expect(step.state).toEqual(stateOf({ conflictPasses: 1, status: 'idle' }));
    expect(step.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
  });

  it('fetches from the tip it holds, whatever current_seq says, or when it says nothing', () => {
    const step = onAnswer(stateOf(), A, { kind: 'seqConflict', currentSeq: null });
    expect(step.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
    expect(onAnswer(stateOf(), A, { kind: 'seqConflict', currentSeq: 40 }).effects).toEqual([
      { kind: 'fetchSince', seq: 4 },
    ]);
  });

  it('the second pass is counted and still only fetches', () => {
    const step = onAnswer(stateOf({ conflictPasses: 1 }), A, conflict);
    expect(step.state.conflictPasses).toBe(2);
    expect(step.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
  });

  it('the third pass in a row fetches and waits 15 s, and the count starts again', () => {
    const step = onAnswer(stateOf({ conflictPasses: 2 }), A, conflict);
    expect(step.state.conflictPasses).toBe(0);
    expect(step.state.status).toBe('idle');
    expect(step.effects).toEqual([
      { kind: 'fetchSince', seq: 4 },
      { kind: 'retryIn', ms: 15000 },
    ]);
  });

  it('after the wait, the next conflict is the first pass again', () => {
    const waited = onAnswer(stateOf({ conflictPasses: 2 }), A, conflict).state;
    const again = onAnswer({ ...waited, status: 'sending' }, A, conflict);
    expect(again.state.conflictPasses).toBe(1);
    expect(again.effects).toEqual([{ kind: 'fetchSince', seq: 4 }]);
  });

  it('three conflicts one after the other come to the wait, and no sooner', () => {
    let state = stateOf();
    const effects: (readonly string[])[] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      const step = onAnswer({ ...state, status: 'sending' }, A, conflict);
      state = step.state;
      effects.push(step.effects.map((effect) => effect.kind));
    }
    expect(effects).toEqual([['fetchSince'], ['fetchSince'], ['fetchSince', 'retryIn']]);
  });

  it('leaves the taps and their counts alone', () => {
    const waiting = tap('key-a', { attempts: 2 });
    const step = onAnswer(stateOf({ queue: queueOf([waiting, B]) }), waiting, conflict);
    expect(step.state.queue.pending).toEqual([waiting, B]);
  });
});

describe('onAnswer: rulesChanged', () => {
  it('takes the new rules version, keeps every tap, and asks for the rules', () => {
    const step = onAnswer(stateOf(), A, { kind: 'rulesChanged', rulesVersion: 3 });
    expect(step.state).toEqual(stateOf({ rulesVersion: 3, status: 'idle' }));
    expect(step.effects).toEqual([{ kind: 'reloadRules' }]);
  });

  it('keeps the queue itself, so what is persisted does not change', () => {
    const state = stateOf();
    const step = onAnswer(state, A, { kind: 'rulesChanged', rulesVersion: 3 });
    expect(step.state.queue).toBe(state.queue);
  });

  it('the queue is sent again with the new rules version', () => {
    const step = onAnswer(stateOf(), A, { kind: 'rulesChanged', rulesVersion: 3 });
    expect(nextSend(step.state)).toMatchObject({ idempotency_key: 'key-a', rules_version: 3 });
  });
});

describe('onAnswer: outdated (the app’s engine is behind)', () => {
  it('is Update needed: the queue kept and persisted, nothing more is sent', () => {
    const step = onAnswer(stateOf(), A, { kind: 'outdated', required: 3 });
    expect(step.state).toEqual(stateOf({ status: 'outdated' }));
    expect(step.effects).toEqual([{ kind: 'persist' }]);
    expect(nextSend(step.state)).toBeNull();
  });
});

describe('onAnswer: linkDead', () => {
  it.each(['LINK_INVALID', 'LINK_REVOKED', 'LINK_EXPIRED'] as const)(
    '%s: the queue is marked dead and persisted, the taps kept',
    (code) => {
      const step = onAnswer(stateOf(), A, { kind: 'linkDead', code });
      expect(step.state).toEqual(
        stateOf({ status: 'dead', queue: queueOf([A, B], { dead: code }) }),
      );
      expect(step.effects).toEqual([{ kind: 'persist' }]);
    },
  );
});

// Review Focus 4: the link revoked with taps queued.
describe('a revoked link with taps queued (Review Focus 4)', () => {
  const dead = () => onAnswer(stateOf(), A, { kind: 'linkDead', code: 'LINK_REVOKED' }).state;

  it('nothing is sent anywhere else: no body, no mark, no send effect', () => {
    expect(nextSend(dead())).toBeNull();
    const state = dead();
    expect(markSending(state)).toBe(state);
    expect(markSending(dead()).status).toBe('dead');
  });

  it('the taps stay as leftovers, whatever else arrives', () => {
    const state = dead();
    const fetched = onLedger(state, [ev(5)]);
    expect(fetched.queue.pending).toEqual([A, B]);
    expect(fetched.queue.dead).toBe('LINK_REVOKED');
    expect(fetched.status).toBe('dead');
  });

  it('a later accepted answer does not bring the queue back to life', () => {
    const step = onAnswer(dead(), B, accepted(5, 'ev-5'));
    expect(step.state.queue.dead).toBe('LINK_REVOKED');
    expect(step.effects.map((effect) => effect.kind)).not.toContain('send');
  });
});

describe('onAnswer: rateLimited', () => {
  it('waits as long as it was told, changing nothing else', () => {
    const step = onAnswer(stateOf(), A, { kind: 'rateLimited', retryAfterMs: 7000 });
    expect(step.state).toEqual(stateOf({ status: 'idle' }));
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 7000 }]);
  });
});

describe('onAnswer: offline', () => {
  it('counts the attempt on the tap that was sent, is offline, and retries in 1 s', () => {
    const step = onAnswer(stateOf(), A, { kind: 'offline' });
    expect(step.state).toEqual(
      stateOf({ status: 'offline', queue: queueOf([tap('key-a', { attempts: 1 }), B]) }),
    );
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 1000 }]);
  });

  // attempts the tap has made so far -> the wait before the next one, from the plan's table
  it.each([
    [0, 1000],
    [1, 2000],
    [2, 5000],
    [3, 10000],
    [4, 15000],
    [5, 15000],
    [40, 15000],
  ] as const)('after %i attempts already made, the next wait is %i ms', (attempts, ms) => {
    const sent = tap('key-a', { attempts });
    const step = onAnswer(stateOf({ queue: queueOf([sent, B]) }), sent, { kind: 'offline' });
    expect(step.effects).toEqual([{ kind: 'retryIn', ms }]);
    expect(step.state.queue.pending[0]?.attempts).toBe(attempts + 1);
  });

  it('counts only the tap that was sent: the others behind it are not tried', () => {
    const step = onAnswer(stateOf(), A, { kind: 'offline' });
    expect(step.state.queue.pending[1]).toEqual(B);
  });

  it('the same answer twice counts one attempt, not two', () => {
    const once = onAnswer(stateOf(), A, { kind: 'offline' });
    const twice = onAnswer(once.state, A, { kind: 'offline' });
    expect(twice.state.queue.pending[0]?.attempts).toBe(1);
  });

  it('keeps the same key for the retry, so a tap the server took is not counted twice', () => {
    const step = onAnswer(stateOf(), A, { kind: 'offline' });
    expect(nextSend(step.state)?.idempotency_key).toBe('key-a');
  });

  it('a tap that left the queue meanwhile leaves the queue as it is', () => {
    const state = stateOf({ queue: queueOf([B]) });
    const step = onAnswer(state, A, { kind: 'offline' });
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects).toEqual([{ kind: 'retryIn', ms: 1000 }]);
  });
});

describe('onAnswer: refused', () => {
  const refused = (code: string, status = 422): AppendAnswer => ({ kind: 'refused', status, code });

  it('drops the tap, says so, fetches the ledger again, and persists', () => {
    const step = onAnswer(stateOf(), A, refused('WRONG_PHASE'));
    expect(step.state).toEqual(stateOf({ status: 'idle', queue: queueOf([B]) }));
    expect(step.effects).toEqual([
      { kind: 'refused', key: 'key-a', code: 'WRONG_PHASE' },
      { kind: 'fetchSince', seq: 4 },
      { kind: 'persist' },
    ]);
  });

  it('passes the server’s code on as it is', () => {
    const step = onAnswer(stateOf(), A, refused('ALREADY_DECIDED', 409));
    expect(step.effects[0]).toEqual({ kind: 'refused', key: 'key-a', code: 'ALREADY_DECIDED' });
  });

  it('drops only the tap that was refused', () => {
    const step = onAnswer(stateOf({ queue: queueOf([A, B, C]) }), B, refused('INVALID_EVENT'));
    expect(step.state.queue.pending).toEqual([A, C]);
  });

  it('counts nothing as the phone’s own, and moves neither tip nor ledger', () => {
    const step = onAnswer(stateOf(), A, refused('WRONG_PHASE'));
    expect(step.state.queue.ownEventIds).toEqual([]);
    expect(step.state.tip).toBe(4);
    expect(step.state.ledger).toEqual(stateOf().ledger);
  });
});

describe('onLedger', () => {
  it('adds what was fetched, in order, and moves the tip to the last of it', () => {
    const state = stateOf({ status: 'idle', conflictPasses: 1 });
    const next = onLedger(state, [ev(5), ev(6)]);
    expect(next).toEqual({ ...state, tip: 6, ledger: [ev(1), ev(2), ev(3), ev(4), ev(5), ev(6)] });
  });

  it('takes events handed over out of order, and keeps the ledger in order', () => {
    const next = onLedger(stateOf(), [ev(6), ev(5)]);
    expect(next.ledger.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(next.tip).toBe(6);
  });

  it('with nothing fetched is the same state, not a copy', () => {
    const state = stateOf();
    expect(onLedger(state, [])).toBe(state);
  });

  it('an event it already holds is not held twice, and the server’s version replaces ours', () => {
    const ours = stateOf({
      tip: 5,
      ledger: [ev(1), ev(2), ev(3), ev(4), ev(5, { recordedAt: 'our guess', deviceLinkId: null })],
    });
    const next = onLedger(ours, [ev(5, { recordedAt: 'the server’s' })]);
    expect(next.ledger).toHaveLength(5);
    expect(next.ledger[4]?.recordedAt).toBe('the server’s');
  });

  it('a fetch from the start rebuilds the same ledger', () => {
    const state = stateOf();
    expect(onLedger(state, [ev(1), ev(2), ev(3), ev(4)]).ledger).toEqual(state.ledger);
  });

  it('never moves the tip back', () => {
    expect(onLedger(stateOf(), [ev(2)]).tip).toBe(4);
  });

  it('keeps a tip beyond the ledger it holds (the bootstrap named a later seq) until the fetch reaches it', () => {
    const next = onLedger(stateOf({ tip: 9 }), [ev(5)]);
    expect(next.tip).toBe(9);
    expect(next.ledger.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps what voids what', () => {
    const voiding = ev(5, { type: 'core.void', voids: 'ev-3' });
    expect(onLedger(stateOf(), [voiding]).ledger[4]?.voids).toBe('ev-3');
  });

  it('leaves the queue, the status and the counts to the answers', () => {
    const state = stateOf({ status: 'offline', conflictPasses: 2 });
    const next = onLedger(state, [ev(5)]);
    expect(next.queue).toBe(state.queue);
    expect(next.status).toBe('offline');
    expect(next.conflictPasses).toBe(2);
    expect(next.rulesVersion).toBe(2);
  });

  it('takes the first events of a match', () => {
    const empty = stateOf({ tip: 0, ledger: [] });
    expect(onLedger(empty, [ev(1)]).tip).toBe(1);
  });
});

describe('revalidate', () => {
  it('keeps everything legal returns, asked about the queue in order', () => {
    const state = stateOf();
    const legal = vi.fn((queued: readonly QueuedEvent[]) => queued.map((q) => q.key));
    const step = revalidate(state, legal);
    expect(legal).toHaveBeenCalledTimes(1);
    expect(legal).toHaveBeenCalledWith([A, B]);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
  });

  it('drops what is no longer legal, says so for each, and persists', () => {
    const step = revalidate(stateOf({ queue: queueOf([A, B, C]) }), () => ['key-b']);
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects).toEqual([
      { kind: 'refused', key: 'key-a', code: NO_LONGER_LEGAL },
      { kind: 'refused', key: 'key-c', code: NO_LONGER_LEGAL },
      { kind: 'persist' },
    ]);
  });

  it('keeps the queue’s order, whatever order legal answers in', () => {
    const step = revalidate(stateOf({ queue: queueOf([A, B, C]) }), () => [
      'key-c',
      'key-a',
      'key-b',
    ]);
    expect(step.state.queue.pending).toEqual([A, B, C]);
    expect(step.effects).toEqual([]);
  });

  it('never adds a tap legal names that is not queued', () => {
    const step = revalidate(stateOf(), () => ['key-a', 'key-b', 'key-ghost']);
    expect(step.state.queue.pending).toEqual([A, B]);
    expect(step.effects).toEqual([]);
  });

  it('an empty queue has nothing to ask about', () => {
    const state = stateOf({ queue: queueOf([]) });
    const legal = vi.fn(() => ['key-ghost']);
    const step = revalidate(state, legal);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
    expect(legal).not.toHaveBeenCalled();
  });

  it('changes nothing but the queue: not the tip, the ledger, the status or the own ids', () => {
    const state = stateOf({
      status: 'idle',
      conflictPasses: 1,
      queue: queueOf([A, B], { ownEventIds: ['ev-3'] }),
    });
    const step = revalidate(state, () => []);
    expect(step.state).toEqual({ ...state, queue: queueOf([], { ownEventIds: ['ev-3'] }) });
  });

  it('keeps the taps’ own counts', () => {
    const waiting = tap('key-b', { attempts: 4 });
    const step = revalidate(stateOf({ queue: queueOf([A, waiting]) }), () => ['key-b']);
    expect(step.state.queue.pending).toEqual([waiting]);
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
    const offline = stateOf({
      status: 'offline',
      queue: queueOf([tap('key-a', { attempts: 2 }), B]),
    });
    const fetched = onLedger(offline, [OTHER_FINISHED]);
    const step = revalidate(fetched, legalAfterForfeit(fetched));
    expect(step.state.queue.pending).toEqual([]);
    expect(step.effects).toEqual([
      { kind: 'refused', key: 'key-a', code: NO_LONGER_LEGAL },
      { kind: 'refused', key: 'key-b', code: NO_LONGER_LEGAL },
      { kind: 'persist' },
    ]);
    expect(nextSend({ ...step.state, status: 'idle' })).toBeNull();
  });

  it('what is still legal stays and goes on at the new tip', () => {
    const fetched = onLedger(stateOf({ status: 'offline' }), [ev(5)]);
    const step = revalidate(fetched, () => ['key-b']);
    expect(step.state.queue.pending).toEqual([B]);
    expect(nextSend({ ...step.state, status: 'idle' })).toMatchObject({
      idempotency_key: 'key-b',
      expected_seq: 5,
    });
  });

  it('the same after the organiser’s rules change under it: reload, then revalidate', () => {
    const changed = onAnswer(stateOf(), A, { kind: 'rulesChanged', rulesVersion: 3 });
    expect(changed.effects).toEqual([{ kind: 'reloadRules' }]);
    const step = revalidate(changed.state, () => ['key-b']);
    expect(step.state.rulesVersion).toBe(3);
    expect(step.state.queue.pending).toEqual([B]);
    expect(step.effects).toEqual([
      { kind: 'refused', key: 'key-a', code: NO_LONGER_LEGAL },
      { kind: 'persist' },
    ]);
  });
});

describe('a queue read back after the app was killed', () => {
  it('sends what was queued, once, with the key it was tapped under', () => {
    const reopened = stateOf({
      status: 'idle',
      queue: queueOf([tap('key-a', { attempts: 3 })], { ownEventIds: ['ev-4'] }),
    });
    expect(nextSend(reopened)).toMatchObject({ idempotency_key: 'key-a', expected_seq: 4 });
    expect(markSending(reopened).status).toBe('sending');
    expect(nextSend(markSending(reopened))).toBeNull();
  });
});
