import { describe, expect, it } from 'vitest';
import {
  canDiscardQueued,
  discardQueued,
  isUnresolved,
  markSending,
  nextSend,
  onFetchFailed,
  onLedger,
  onReadFailed,
  onRules,
  revalidate,
  type SyncState,
} from '@/domain/scoring/sync';
import {
  NOW,
  tap,
  A,
  B,
  ev,
  queueOf,
  stateOf,
  restingOf,
  accepted,
  refusal,
  answer,
} from '@/domain/scoring/sync.testkit';
import type { AppendAnswer } from '@/domain/scoring/wire';

describe('onAnswer: seqConflict', () => {
  const conflict: AppendAnswer = { kind: 'seqConflict', currentSeq: 6 };

  it('counts a pass and fetches from the tip, holds the queue until it lands, and frees the tap', () => {
    const step = answer(stateOf(), A, conflict);
    expect(step.state).toEqual(
      stateOf({
        conflictPasses: 1,
        status: 'idle',
        inFlight: null,
        hold: 'ledger',
        refusedRun: { by: 'conflict', count: 1 },
      }),
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
        rulesSaid: 3,
        refusedRun: { by: 'rules', count: 1 },
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
    expect(nextSend(failed.state, NOW + 15000)).toMatchObject({
      idempotency_key: 'key-a',
      rules_version: 2,
    });
    const resent = markSending(failed.state, NOW + 15000).state;
    const again = answer(resent, A, changed, NOW + 15000);
    expect(again.effects).toContainEqual({ kind: 'reloadRules' });
    expect(again.state.rulesPasses).toBe(2);
  });

  it('an accepted answer that names newer rules, and a rules read that fails, sends under the old version', () => {
    const asked = answer(stateOf(), A, accepted(5, 'ev-5', 3)).state;
    const failed = onFetchFailed(asked, NOW).state;
    expect(failed.rulesVersion).toBe(2);
    expect(nextSend(failed, NOW + 15000)).toMatchObject({
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

// The 2026-11-02 device stall: a match nobody had corrected is at rules_version 0 (the web's column default), the phone
// held 1 because it had never been told, and `onRules` only ever raised the version, so every send was refused
// FIXTURE_RULES_CHANGED {rules_version: 0} for good. A version the server names twice (the refusal, then the rules read)
// is its word even when it is lower: a phone ahead of the server can only be a phone that guessed.
describe('the rules version the server names', () => {
  const named = (rulesVersion: number): AppendAnswer => ({ kind: 'rulesChanged', rulesVersion });

  it('a refusal remembers the version it named, and still holds its own until the rules come', () => {
    const step = answer(restingOf({ rulesVersion: 1 }), A, named(0));
    expect(step.state.rulesSaid).toBe(0);
    expect(step.state.rulesVersion).toBe(1);
  });

  it('the rules read of exactly that version is taken even though it is lower: the phone had guessed', () => {
    const asked = answer(restingOf({ rulesVersion: 1 }), A, named(0)).state;
    const taken = onRules(asked, { rulesVersion: 0 });
    expect(taken.rulesVersion).toBe(0);
    expect(taken.hold).toBe('revalidate');
    expect(
      nextSend(revalidate(taken, (queued) => queued.map((q) => q.key)).state, NOW),
    ).toMatchObject({
      idempotency_key: 'key-a',
      rules_version: 0,
    });
  });

  it('a lower read that is not the version named is a read lagging behind: the version held stays', () => {
    const asked = answer(restingOf({ rulesVersion: 5 }), A, named(3)).state;
    expect(onRules(asked, { rulesVersion: 2 }).rulesVersion).toBe(5);
  });

  it('a higher read is taken, named or not', () => {
    const asked = answer(restingOf({ rulesVersion: 1 }), A, named(3)).state;
    expect(onRules(asked, { rulesVersion: 4 }).rulesVersion).toBe(4);
  });

  it('the word is spent by the read: a later lower read is a lagging one again', () => {
    const asked = answer(restingOf({ rulesVersion: 1 }), A, named(0)).state;
    const taken = onRules(asked, { rulesVersion: 0 });
    expect(taken.rulesSaid).toBeNull();
    expect(onRules({ ...taken, rulesVersion: 4 }, { rulesVersion: 0 }).rulesVersion).toBe(4);
  });

  it('an accepted tap spends it too: the server took the version that was sent', () => {
    const asked = answer(restingOf({ rulesVersion: 1 }), A, named(0)).state;
    expect(answer(asked, A, accepted(5, 'ev-5', 1)).state.rulesSaid).toBeNull();
  });
});

// The sender's own stall (`stallOf`): the server answers, and never takes the tap. The three-in-a-row pause resets
// `conflictPasses` and `rulesPasses`, so the run that matters is counted apart, across the pauses: a conflict and a rules
// change alike (review, 2026-11-02: something moving does not make it a fresh run), until the queue empties. Once it is
// a stall (the sixth), the pause is 60 s, not 15: a phone that cannot get a tap through stops asking every 15 s.
describe('refusals in a row', () => {
  const conflict: AppendAnswer = { kind: 'seqConflict', currentSeq: 9 };
  const changed: AppendAnswer = { kind: 'rulesChanged', rulesVersion: 0 };
  /** The state between two sends: the refused tap is back at the head, nothing on its way, no hold. */
  const again = (state: SyncState): SyncState => ({
    ...state,
    hold: null,
    status: 'idle',
    inFlight: null,
    notBefore: 0,
  });

  it('are counted by kind, across the pause that resets the passes', () => {
    let state = restingOf({ rulesVersion: 1 });
    for (let i = 1; i <= 7; i += 1) {
      state = answer(state, A, changed).state;
      expect(state.refusedRun).toEqual({ by: 'rules', count: i });
      state = again(state);
    }
    expect(state.rulesPasses).toBe(1);
  });

  it('are counted together, a rules change and a conflict alike: something moving does not start them again', () => {
    let state = restingOf({ rulesVersion: 1 });
    const kinds = [conflict, changed, conflict, changed, conflict, changed] as const;
    kinds.forEach((said, at) => {
      state = answer(state, A, said).state;
      expect(state.refusedRun, `refusal ${at + 1}`).toEqual({
        by: said.kind === 'seqConflict' ? 'conflict' : 'rules',
        count: at + 1,
      });
      state = again(state);
    });
  });

  it('end when a tap is accepted', () => {
    const refused = answer(restingOf(), A, conflict).state;
    expect(refused.refusedRun).toEqual({ by: 'conflict', count: 1 });
    const taken = answer(
      { ...refused, status: 'sending', inFlight: 'key-a' },
      A,
      accepted(5, 'ev-5'),
    );
    expect(taken.state.refusedRun).toBeNull();
  });

  // Review, 2026-11-02: `stallOf` needs a queued tap, but the run kept its count, so a NEW tap after the queue had
  // emptied another way (an Undo of a queued tap, a refused tap) was a stall at its first refusal.
  describe('end when the queue empties, whichever way it empties', () => {
    const run = { by: 'rules', count: 5 } as const;

    it('a queued tap discarded (Undo before it went) leaves the run while another tap is queued, and ends it with the last', () => {
      const queued = restingOf({ refusedRun: run, queue: queueOf([A, B]) });
      const one = discardQueued(queued, 'key-b').state;
      expect(one.queue.pending).toEqual([A]);
      expect(one.refusedRun).toEqual(run);
      const none = discardQueued(one, 'key-a').state;
      expect(none.queue.pending).toEqual([]);
      expect(none.refusedRun).toBeNull();
    });

    it('a tap the server refused for good (it left the queue without counting) ends it when it was the last', () => {
      const only = restingOf({
        refusedRun: run,
        queue: queueOf([A]),
        inFlight: 'key-a',
        status: 'sending',
      });
      const step = answer(only, A, refusal('WRONG_PHASE'));
      expect(step.state.queue.pending).toEqual([]);
      expect(step.state.refusedRun).toBeNull();
    });

    it('a new tap after that is a first refusal, not the sixth', () => {
      const none = discardQueued(
        restingOf({ refusedRun: run, queue: queueOf([A]) }),
        'key-a',
      ).state;
      const fresh = { ...none, queue: queueOf([B]) };
      expect(answer(again(fresh), B, changed).state.refusedRun).toEqual({ by: 'rules', count: 1 });
    });
  });

  it('an offline answer, a throttle and a one-tap refusal are not the server refusing to take taps: the run stands', () => {
    const refused = answer(restingOf(), A, conflict).state;
    const down = answer({ ...refused, status: 'sending', inFlight: 'key-a' }, A, {
      kind: 'offline',
    });
    expect(down.state.refusedRun).toEqual({ by: 'conflict', count: 1 });
  });

  describe('the pause', () => {
    const retries = (count: number, said: AppendAnswer) => {
      let state = restingOf({ rulesVersion: 1 });
      const asked: (number | null)[] = [];
      for (let i = 1; i <= count; i += 1) {
        const step = answer(state, A, said, NOW);
        const retry = step.effects.find((effect) => effect.kind === 'retryIn');
        asked.push(retry?.kind === 'retryIn' ? retry.ms : null);
        state = again(step.state);
      }
      return asked;
    };

    it('is 15 s on the third refusal and 60 s on the sixth, which is the stall: none between', () => {
      expect(retries(6, changed)).toEqual([null, null, 15_000, null, null, 60_000]);
      expect(retries(6, conflict)).toEqual([null, null, 15_000, null, null, 60_000]);
    });

    it('stays 60 s on every pause after the stall', () => {
      expect(retries(12, changed)).toEqual([
        null,
        null,
        15_000,
        null,
        null,
        60_000,
        null,
        null,
        60_000,
        null,
        null,
        60_000,
      ]);
    });

    it('sends nothing sooner than the pause says, 60 s once stalled', () => {
      const sixth = answer(
        restingOf({ rulesVersion: 1, refusedRun: { by: 'rules', count: 5 }, rulesPasses: 2 }),
        A,
        changed,
        NOW,
      );
      expect(sixth.state.notBefore).toBe(NOW + 60_000);
      const third = answer(
        restingOf({ rulesVersion: 1, refusedRun: { by: 'rules', count: 2 }, rulesPasses: 2 }),
        A,
        changed,
        NOW,
      );
      expect(third.state.notBefore).toBe(NOW + 15_000);
    });

    it('counts a mixed run for the stall as it does for the stall’s reading: the sixth of any kind is 60 s', () => {
      const mixed = restingOf({
        rulesVersion: 1,
        refusedRun: { by: 'conflict', count: 5 },
        rulesPasses: 2,
      });
      const step = answer(mixed, A, changed, NOW);
      expect(step.effects).toContainEqual({ kind: 'retryIn', ms: 60_000 });
    });
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

// A read can say Update needed or too long while a tap is in flight; that tap's answer must not undo it.
describe('a status only a new session lifts: outdated, tooLarge (an answer in flight cannot overwrite it)', () => {
  const answers: [string, AppendAnswer][] = [
    ['accepted', accepted(5, 'ev-5')],
    ['a replayed accepted', accepted(4, 'ev-4')],
    ['seqConflict', { kind: 'seqConflict', currentSeq: 6 }],
    ['rulesChanged', { kind: 'rulesChanged', rulesVersion: 3 }],
    ['rateLimited', { kind: 'rateLimited', retryAfterMs: 1000 }],
    ['offline', { kind: 'offline' }],
    ['a refusal', refusal('WRONG_PHASE')],
    ['ALREADY_DECIDED', refusal('ALREADY_DECIDED')],
  ];

  it.each(['tooLarge', 'outdated'] as const)(
    'a read that said %s stands through any answer',
    (status) => {
      for (const [name, said] of answers) {
        const step = answer(stateOf({ status }), A, said);
        expect(step.state.status, name).toBe(status);
        expect(
          step.effects.map((effect) => effect.kind),
          name,
        ).not.toContain('send');
      }
    },
  );

  it('only the read that says it sets it, over a dead queue never', () => {
    const dead = restingOf({ queue: queueOf([A, B], { dead: 'gone' }), status: 'dead' });
    expect(onReadFailed(dead, { kind: 'tooLarge' }, NOW).state.status).toBe('dead');
    expect(onReadFailed(dead, { kind: 'outdated', required: 3 }, NOW).state.status).toBe('dead');
  });

  it('a dead queue answered offline stays dead', () => {
    const dead = stateOf({ status: 'dead', queue: queueOf([A, B], { dead: 'LINK_REVOKED' }) });
    expect(answer(dead, A, { kind: 'offline' }).state.status).toBe('dead');
  });

  it('tooLarge does not turn into outdated, nor the reverse, by a second read', () => {
    const large = onReadFailed(restingOf(), { kind: 'tooLarge' }, NOW).state;
    expect(onReadFailed(large, { kind: 'outdated', required: 3 }, NOW).state.status).toBe(
      'tooLarge',
    );
    const old = onReadFailed(restingOf(), { kind: 'outdated', required: 3 }, NOW).state;
    expect(onReadFailed(old, { kind: 'tooLarge' }, NOW).state.status).toBe('outdated');
  });

  it('an ordinary answer after an ordinary state is still idle or offline', () => {
    const alone = stateOf({ queue: queueOf([A]) });
    expect(answer(alone, A, accepted(5, 'ev-5')).state.status).toBe('idle');
    expect(answer(alone, A, { kind: 'offline' }).state.status).toBe('offline');
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
