import { describe, expect, it } from 'vitest';
import {
  markSending,
  nextSend,
  onFetchFailed,
  onReadFailed,
  onRules,
  retryRules,
} from '@/domain/scoring/sync';
import { NOW, A, B, queueOf, stateOf, restingOf, answer } from '@/domain/scoring/sync.testkit';
import type { AppendAnswer } from '@/domain/scoring/wire';

// A failed rules read with nothing queued is never provoked again by a send (no send, no FIXTURE_RULES_CHANGED), so the
// phone would fold stale rules for good: the read itself is asked for again, 15 s later, as often as it fails.
describe('a rules read that fails (retryRules)', () => {
  const asked = () =>
    onFetchFailed(
      answer(stateOf({ queue: queueOf([]) }), A, { kind: 'rulesChanged', rulesVersion: 3 }).state,
      NOW,
    );

  it('with nothing queued: waits 15 s, then asks for the rules again, holding the queue for them', () => {
    const failed = asked();
    expect(failed.effects).toEqual([{ kind: 'retryIn', ms: 15000 }]);
    expect(failed.state.hold).toBeNull();
    expect(failed.state.rulesRetryAt).toBe(NOW + 15000);
    const early = retryRules(failed.state, NOW + 14999);
    expect(early.state).toBe(failed.state);
    expect(early.effects).toEqual([]);
    const due = retryRules(failed.state, NOW + 15000);
    expect(due.effects).toEqual([{ kind: 'reloadRules' }]);
    expect(due.state.hold).toBe('rules');
    expect(due.state.rulesRetryAt).toBeNull();
    expect(due.state.rulesVersion).toBe(2);
  });

  it('asks once per due time: a second call before the read lands does not ask again', () => {
    const due = retryRules(asked().state, NOW + 15000);
    const again = retryRules(due.state, NOW + 15000);
    expect(again.state).toBe(due.state);
    expect(again.effects).toEqual([]);
  });

  it('a read that fails again is waited for again, as often as it fails, never faster than 15 s', () => {
    let state = asked().state;
    let clock = NOW;
    for (let round = 0; round < 4; round += 1) {
      clock += 15000;
      const due = retryRules(state, clock);
      expect(due.effects).toEqual([{ kind: 'reloadRules' }]);
      const failed = onFetchFailed(due.state, clock);
      expect(failed.effects).toEqual([{ kind: 'retryIn', ms: 15000 }]);
      expect(failed.state.rulesRetryAt).toBe(clock + 15000);
      state = failed.state;
    }
  });

  it('the rules landing ends it: nothing is asked again', () => {
    const due = retryRules(asked().state, NOW + 15000);
    const taken = onRules(due.state, { rulesVersion: 3 });
    expect(taken.rulesRetryAt).toBeNull();
    expect(taken.rulesVersion).toBe(3);
    expect(retryRules(taken, NOW + 99_000).effects).toEqual([]);
  });

  it('rules that land before the retry is due end it too, under any hold', () => {
    const taken = onRules(asked().state, { rulesVersion: 3 });
    expect(taken.rulesRetryAt).toBeNull();
    expect(retryRules(taken, NOW + 15000).effects).toEqual([]);
    const underLedger = onRules(restingOf({ hold: 'ledger', rulesRetryAt: NOW + 5 }), {
      rulesVersion: 3,
    });
    expect(underLedger.rulesRetryAt).toBeNull();
  });

  it.each(['ledger', 'status', 'revalidate', 'rules'] as const)(
    'with a %s hold already standing it waits: no second read is started over it, and it is still due',
    (hold) => {
      const state = restingOf({ hold, rulesRetryAt: NOW });
      const step = retryRules(state, NOW + 1);
      expect(step.state).toBe(state);
      expect(step.effects).toEqual([]);
    },
  );

  it('with nothing due there is nothing to ask', () => {
    const state = restingOf();
    const step = retryRules(state, NOW + 99_000);
    expect(step.state).toBe(state);
    expect(step.effects).toEqual([]);
  });

  it('with taps queued the sends wait the same 15 s, and the retry holds them until the rules land', () => {
    const changed: AppendAnswer = { kind: 'rulesChanged', rulesVersion: 3 };
    const failed = onFetchFailed(answer(stateOf(), A, changed).state, NOW);
    expect(nextSend(failed.state, NOW + 14999)).toBeNull();
    expect(nextSend(failed.state, NOW + 15000)).toMatchObject({ rules_version: 2 });
    const due = retryRules(failed.state, NOW + 15000);
    expect(nextSend(due.state, NOW + 15000)).toBeNull();
  });

  it('a ledger or a status read that fails does not ask for rules', () => {
    for (const hold of ['ledger', 'status'] as const) {
      const failed = onFetchFailed(restingOf({ hold }), NOW);
      expect(failed.state.rulesRetryAt).toBeNull();
      expect(retryRules(failed.state, NOW + 99_000).effects).toEqual([]);
    }
  });

  it('a throttled rules read waits as long as it was told, 15 s at least', () => {
    const rules = restingOf({ hold: 'rules' });
    const short = onReadFailed(rules, { kind: 'rateLimited', retryAfterMs: 9000 }, NOW);
    expect(short.effects).toEqual([{ kind: 'retryIn', ms: 15000 }]);
    expect(short.state.rulesRetryAt).toBe(NOW + 15000);
    const long = onReadFailed(rules, { kind: 'rateLimited', retryAfterMs: 20000 }, NOW);
    expect(long.effects).toEqual([{ kind: 'retryIn', ms: 20000 }]);
    expect(long.state.rulesRetryAt).toBe(NOW + 20000);
  });

  it('a rules read that fails outright (offline) is the same: asked for again', () => {
    const failed = onReadFailed(restingOf({ hold: 'rules' }), { kind: 'offline' }, NOW);
    expect(failed.state.rulesRetryAt).toBe(NOW + 15000);
  });

  it('a retry that comes due changes nothing but the hold and the due time', () => {
    const state = restingOf({ rulesRetryAt: NOW + 100 });
    const due = retryRules(state, NOW + 100);
    expect(due.state).toEqual({ ...state, hold: 'rules', rulesRetryAt: null });
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
    [403, 'RESULT_CARRIED_FORWARD', 'carriedForward'],
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
    for (const [hold, ms] of [
      ['ledger', 5000],
      ['rules', 15000],
      ['status', 5000],
    ] as const) {
      const step = onReadFailed(held(hold), { kind: 'offline' }, NOW);
      expect(step.state.hold).toBeNull();
      expect(step.effects).toEqual([{ kind: 'retryIn', ms }]);
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
    const step = onReadFailed(held('ledger'), { kind: 'seqConflict', currentSeq: null }, NOW);
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
  it.each([
    ['ledger', 5000],
    ['status', 5000],
    ['rules', 15000],
  ] as const)(
    'lets go of a %s hold, and waits %i ms before sending on what is held',
    (hold, ms) => {
      const step = onFetchFailed(restingOf({ hold }), NOW);
      expect(step.state.hold).toBeNull();
      expect(step.state.notBefore).toBe(NOW + ms);
      expect(step.effects).toEqual([{ kind: 'retryIn', ms }]);
      expect(nextSend(step.state, NOW + ms - 1)).toBeNull();
      expect(nextSend(step.state, NOW + ms)).not.toBeNull();
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
