import { describe, expect, it } from 'vitest';
import {
  nextSend,
  onBootstrapStatus,
  onFetchFailed,
  onLedger,
  onReadFailed,
  revalidate,
  STALL_AFTER,
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
  refusal,
  answer,
} from '@/domain/scoring/sync.testkit';

/** A ledger of seven events, to tell a read from the tip from a read from a number the tests happen to use. */
const AT_SEVEN: Partial<SyncState> = {
  tip: 7,
  ledger: [1, 2, 3, 4, 5, 6, 7].map((seq) => ev(seq)),
};

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

  // The refusal's own fetchSince is still out: the revalidation waits for it (hold 'ledger'; heldAfter turns it into
  // 'revalidate' when it lands) instead of judging the tap behind on the stale ledger.
  it('a revalidation owed is done, after the fetch it asked for, before the next tap goes', () => {
    const tried = tap('key-a', { attempts: 1 });
    const state = stateOf({ queue: queueOf([tried, B]), revalidateOwed: true });
    const refusedStep = answer(state, tried, refusal('WRONG_PHASE'));
    expect(refusedStep.state.hold).toBe('ledger');
    expect(refusedStep.effects).toContainEqual({ kind: 'fetchSince', seq: 4 });
    expect(nextSend(refusedStep.state, NOW)).toBeNull();
    const landed = onLedger(refusedStep.state, [ev(5)]).state;
    expect(landed.hold).toBe('revalidate');
    expect(nextSend(landed, NOW)).toBeNull();
    expect(onLedger(refusedStep.state, []).state.hold).toBe('revalidate');
    const alone = stateOf({ queue: queueOf([tried]), revalidateOwed: true });
    const lone = answer(alone, tried, refusal('WRONG_PHASE')).state;
    expect(lone.hold).toBeNull();
    expect(lone.revalidateOwed).toBe(false);
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
    [403, 'RESULT_CARRIED_FORWARD', 'carriedForward'],
    [404, 'NOT_FOUND', 'gone'],
  ] as const)(
    '%i %s: the queue is dead (%s), the taps kept, nothing more is sent',
    (status, code, word) => {
      const step = answer(stateOf(), A, refusal(code, status));
      expect(step.state).toEqual(
        stateOf({ status: 'dead', inFlight: null, queue: queueOf([A, B], { dead: word }) }),
      );
      // A result that stands reads the ledger once more (below); every other word saves and does nothing else.
      expect(step.effects).toEqual(
        word === 'carriedForward'
          ? [{ kind: 'persist' }, { kind: 'fetchSince', seq: 4 }]
          : [{ kind: 'persist' }],
      );
      expect(nextSend({ ...step.state, status: 'idle' }, NOW)).toBeNull();
    },
  );

  // Controller, 2026-11-04 (fix round 1). Nothing reads the ledger once the queue is dead (`wanting` is shut), and a
  // result that stands is scored from it (`resultStands`), so the close reads it once more: one `fetchSince` at the tip,
  // after the save. Only the two words that mean a result stands.
  it('closing on a carried-forward result reads the ledger once, from the tip, after the save', () => {
    const step = answer(stateOf(AT_SEVEN), A, refusal('RESULT_CARRIED_FORWARD', 403));
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 7 }]);
  });

  it('a carried-forward answer to a queue already closed on a result that stands reads nothing: it is the same close', () => {
    const closed = answer(stateOf(AT_SEVEN), A, refusal('RESULT_CARRIED_FORWARD', 403));
    expect(closed.state.queue.dead).toBe('carriedForward');
    const again = answer(closed.state, A, refusal('RESULT_CARRIED_FORWARD', 403));
    expect(again.effects).toEqual([{ kind: 'persist' }]);
  });

  it('a result that stands after a close that said none (a link revoked) is a new close: the ledger is read', () => {
    const revoked = restingOf({
      ...AT_SEVEN,
      status: 'dead',
      queue: queueOf([A, B], { dead: 'LINK_REVOKED' }),
    });
    const step = onBootstrapStatus(revoked, 'finalized');
    expect(step.state.queue.dead).toBe('finalized');
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 7 }]);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [402, 'PAYMENT_REQUIRED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ] as const)('closing on %i %s reads nothing: no result stands', (status, code) => {
    expect(answer(stateOf(), A, refusal(code, status)).effects).toEqual([{ kind: 'persist' }]);
  });

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

  // Task 8d (device check, 2026-11-04): the Undo of a decided match whose result the web has carried forward is refused
  // 403 RESULT_CARRIED_FORWARD (usecases/scoring.ts, before it looks at the void). The match is not finalized: nobody
  // locked it. The queue dies with its own word, every tap kept, and the Undo is not sent again.
  it('a void’s 403 that is the carried-forward result still closes the queue, with its own word, never finalized', () => {
    const sent = tap('key-v', { type: 'core.void', payload: { event_id: 'ev-2' } });
    const step = answer(
      stateOf({ queue: queueOf([sent, B]), inFlight: 'key-v' }),
      sent,
      refusal('RESULT_CARRIED_FORWARD', 403),
    );
    expect(step.state.queue.dead).toBe('carriedForward');
    expect(step.state.queue.pending).toEqual([sent, B]);
    expect(step.effects).toEqual([{ kind: 'persist' }, { kind: 'fetchSince', seq: 4 }]);
    expect(nextSend({ ...step.state, status: 'idle' }, NOW)).toBeNull();
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
    // A finalize is a result that stands: the ledger is read once more. A cancelled match has no result.
    expect(step.effects).toEqual(
      status === 'finalized'
        ? [{ kind: 'persist' }, { kind: 'fetchSince', seq: 4 }]
        : [{ kind: 'persist' }],
    );
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
    'a status that says %s refuses that tap alone, fetches the ledger, and holds the queue for it',
    (status) => {
      const step = onBootstrapStatus(decided().state, status);
      expect(step.state.queue.dead).toBeNull();
      expect(step.state.queue.pending).toEqual([B]);
      expect(step.state.decidedProbe).toBeNull();
      expect(step.state.hold).toBe('ledger');
      expect(step.state.revalidateOwed).toBe(true);
      expect(step.effects).toEqual([
        { kind: 'refused', key: 'key-a', code: 'ALREADY_DECIDED' },
        { kind: 'fetchSince', seq: 4 },
        { kind: 'persist' },
      ]);
    },
  );

  // The ledger the refusal asked for has not landed: the tap behind must not be judged on the stale one, or sent.
  it('the next tap does not go before the ledger the refusal asked for, nor before it is revalidated', () => {
    const refused = onBootstrapStatus(decided().state, 'decided').state;
    expect(nextSend(refused, NOW)).toBeNull();
    const early = revalidate(refused, (queued) => queued.map((q) => q.key));
    expect(early.state.hold).toBe('ledger');
    expect(nextSend(early.state, NOW)).toBeNull();
    const landed = onLedger(refused, [ev(5)]).state;
    expect(landed.hold).toBe('revalidate');
    expect(nextSend(landed, NOW)).toBeNull();
    const looked = revalidate(landed, (queued) => queued.map((q) => q.key)).state;
    expect(nextSend(looked, NOW)).toMatchObject({ idempotency_key: 'key-b', expected_seq: 5 });
  });

  it('a ledger fetch that brings nothing still has the queue judged before the next tap goes', () => {
    const refused = onBootstrapStatus(decided().state, 'decided').state;
    const landed = onLedger(refused, []).state;
    expect(landed.hold).toBe('revalidate');
    expect(nextSend(landed, NOW)).toBeNull();
  });

  it('a ledger fetch that never lands still has the queue judged before the next tap goes', () => {
    const refused = onBootstrapStatus(decided().state, 'decided').state;
    const failed = onFetchFailed(refused, NOW).state;
    expect(failed.hold).toBe('revalidate');
    expect(nextSend(failed, NOW + 5000)).toBeNull();
  });

  it('with nothing behind the refused tap the fetch has nothing to hold back or judge', () => {
    const alone = { ...decided().state, queue: queueOf([A]) };
    const refused = onBootstrapStatus(alone, 'decided').state;
    expect(refused.revalidateOwed).toBe(false);
    expect(onLedger(refused, []).state.hold).toBeNull();
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
      expect(step.effects).toEqual(
        status === 'finalized'
          ? [{ kind: 'persist' }, { kind: 'fetchSince', seq: 4 }]
          : [{ kind: 'persist' }],
      );
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

// Review minor 2 (round 2, 2026-11-02): a server that answers ALREADY_DECIDED and a status read that never lands is a
// loop of its own (send, refused, read, fail, wait 5 s, send ...) the run never counted, so no stall was ever said.
describe('a status read that never lands, after ALREADY_DECIDED, counts as a refusal', () => {
  /** The head sent again after a read gave up: nothing on its way but this, no hold. */
  const resent = (state: SyncState): SyncState => ({
    ...state,
    status: 'sending',
    inFlight: 'key-a',
    notBefore: 0,
  });

  it('each cycle adds one, by `decided`, and the sixth is the stall’s count', () => {
    let state = stateOf({ queue: queueOf([A, B]) });
    for (let cycle = 1; cycle <= STALL_AFTER; cycle += 1) {
      const held = answer(state, A, refusal('ALREADY_DECIDED')).state;
      // The refusal itself counts nothing yet: the read may still say why (a closed match, a plain refusal).
      expect(held.refusedRun).toEqual(cycle === 1 ? null : { by: 'decided', count: cycle - 1 });
      const failed = onFetchFailed(held, NOW);
      expect(failed.state.refusedRun).toEqual({ by: 'decided', count: cycle });
      state = resent(failed.state);
    }
    expect(state.refusedRun).toEqual({ by: 'decided', count: STALL_AFTER });
  });

  it('counts across kinds: conflicts and these cycles are one run', () => {
    const conflicted = answer(stateOf(), A, { kind: 'seqConflict', currentSeq: 6 }).state;
    const held = answer(
      resent({ ...conflicted, hold: null, notBefore: 0 }),
      A,
      refusal('ALREADY_DECIDED'),
    );
    expect(onFetchFailed(held.state, NOW).state.refusedRun).toEqual({ by: 'decided', count: 2 });
  });

  it('a status that lands is not one: the tap is refused for good, and the run stands as it was', () => {
    const held = answer(stateOf({ queue: queueOf([A, B]) }), A, refusal('ALREADY_DECIDED')).state;
    const landed = onBootstrapStatus(held, 'in_play').state;
    expect(landed.refusedRun).toBeNull();
  });

  it('a ledger or rules read that does not land adds none: its refusal was counted when it came', () => {
    const conflicted = answer(stateOf(), A, { kind: 'seqConflict', currentSeq: 6 }).state;
    expect(onFetchFailed(conflicted, NOW).state.refusedRun).toEqual({ by: 'conflict', count: 1 });
    const changed = answer(stateOf(), A, { kind: 'rulesChanged', rulesVersion: 3 }).state;
    expect(onFetchFailed(changed, NOW).state.refusedRun).toEqual({ by: 'rules', count: 1 });
  });

  it('a throttled read counts the same: the server answered, and the tap has not gone', () => {
    const held = answer(stateOf({ queue: queueOf([A, B]) }), A, refusal('ALREADY_DECIDED')).state;
    const throttled = onReadFailed(held, { kind: 'rateLimited', retryAfterMs: 20_000 }, NOW);
    expect(throttled.state.refusedRun).toEqual({ by: 'decided', count: 1 });
  });
});
