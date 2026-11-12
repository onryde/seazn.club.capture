import { describe, expect, it } from 'vitest';
import { markSending, nextSend } from '@/domain/scoring/sync';
import { amendQueued, heldTapOf, releaseHeld } from '@/domain/scoring/syncHold';
import { NOW, tap, A, queueOf, restingOf } from '@/domain/scoring/sync.testkit';

// A tap held unsent for a moment (S2-7 ruling 234, Task 17): the shared queue's one addition. A tap with no `holdUntil` is
// sent as it always was; a held one is not sent before its time, and while it is held and unsent its payload may be
// amended once. Every sport's queue goes through these rules; only a sport that sets a hold ever meets them.

const HOLD_UNTIL = NOW + 10_000;
const HELD = tap('key-h', { payload: { by: 'ent-home' }, holdUntil: HOLD_UNTIL });
const TAGGED = { by: 'ent-home', meta: { kind: 'ace' } };

/** Nothing on its way, the held tap alone in the queue. */
const heldState = (held = HELD) => restingOf({ queue: queueOf([held]) });

describe('nextSend and a held tap', () => {
  it('sends a tap with no hold at once, as before', () => {
    expect(nextSend(restingOf({ queue: queueOf([A]) }), NOW)?.idempotency_key).toBe('key-a');
  });

  it('sends nothing while the head is held, and the tap at the moment its hold ends', () => {
    expect(nextSend(heldState(), HOLD_UNTIL - 1)).toBeNull();
    expect(nextSend(heldState(), HOLD_UNTIL)?.idempotency_key).toBe('key-h');
  });

  it('marks no attempt while the head is held', () => {
    const state = heldState();
    const marked = markSending(state, HOLD_UNTIL - 1);
    expect(marked.state).toBe(state);
    expect(marked.effects).toEqual([]);
  });
});

describe('amendQueued', () => {
  it('takes the new payload while the tap is held and unsent, releases the hold and saves the queue', () => {
    const { state, effects } = amendQueued(heldState(), 'key-h', TAGGED, NOW);
    expect(state.queue.pending).toEqual([
      {
        key: 'key-h',
        type: 'badminton.rally',
        payload: TAGGED,
        rulesVersion: 2,
        createdAt: '2026-11-02T10:00:00.000Z',
        attempts: 0,
      },
    ]);
    expect(effects).toEqual([{ kind: 'persist' }]);
    expect(nextSend(state, NOW)?.payload).toEqual(TAGGED);
  });

  it('changes nothing a second time: the first amend released the hold (a second chip tap)', () => {
    const once = amendQueued(heldState(), 'key-h', TAGGED, NOW).state;
    const twice = amendQueued(once, 'key-h', { by: 'ent-home', meta: { kind: 'winner' } }, NOW);
    expect(twice.state).toBe(once);
    expect(twice.effects).toEqual([]);
  });

  it('changes nothing once the hold has run out (a chip after the hold expired)', () => {
    const state = heldState();
    const late = amendQueued(state, 'key-h', TAGGED, HOLD_UNTIL);
    expect(late.state).toBe(state);
    expect(late.effects).toEqual([]);
  });

  it('changes nothing for a tap that is on its way, or was sent with no answer', () => {
    const flying = restingOf({ queue: queueOf([HELD]), inFlight: 'key-h', status: 'sending' });
    expect(amendQueued(flying, 'key-h', TAGGED, NOW).state).toBe(flying);
    const tried = heldState({ ...HELD, attempts: 1 });
    expect(amendQueued(tried, 'key-h', TAGGED, NOW).state).toBe(tried);
  });

  it('changes nothing for a tap that was never held, or a key the queue does not hold', () => {
    const plain = restingOf({ queue: queueOf([A]) });
    expect(amendQueued(plain, 'key-a', TAGGED, NOW).state).toBe(plain);
    const state = heldState();
    expect(amendQueued(state, 'key-gone', TAGGED, NOW).state).toBe(state);
  });
});

describe('releaseHeld', () => {
  it('lets every held tap go at once, keeping all else', () => {
    const released = releaseHeld(heldState());
    expect(released.queue.pending[0]).not.toHaveProperty('holdUntil');
    expect(released.queue.pending[0].payload).toEqual({ by: 'ent-home' });
    expect(nextSend(released, NOW)?.idempotency_key).toBe('key-h');
  });

  it('is the same state when nothing is held', () => {
    const plain = restingOf({ queue: queueOf([A]) });
    expect(releaseHeld(plain)).toBe(plain);
  });
});

describe('heldTapOf', () => {
  it('names the tap held now, and none once its hold has run out', () => {
    expect(heldTapOf(heldState(), NOW)?.key).toBe('key-h');
    expect(heldTapOf(heldState(), HOLD_UNTIL)).toBeNull();
  });

  it('names none when nothing is held, or the held tap is on its way', () => {
    expect(heldTapOf(restingOf({ queue: queueOf([A]) }), NOW)).toBeNull();
    const flying = restingOf({ queue: queueOf([HELD]), inFlight: 'key-h', status: 'sending' });
    expect(heldTapOf(flying, NOW)).toBeNull();
  });
});
