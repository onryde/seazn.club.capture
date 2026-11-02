import { describe, expect, it } from 'vitest';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { foldQueue } from '@/domain/scoring/scoringMatchState';
import { step } from '@/domain/scoring/scoringMatch';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import {
  BROWSER_LINK,
  PHONE_LINK,
  SINGLES,
  ledgerOf,
  queuedOf,
  rally,
  rallies,
  start,
  voiding,
} from '../../../test/badmintonLedger';
import {
  ACCEPTED,
  AT,
  NOW,
  opened,
  queueOf,
  ready,
  savesOf,
  sendsOf,
  sentOnce,
  tapped,
} from '../../../test/scoringMatchFixtures';

// Undo of a tap whose fate is unknown (plan S2-1 Task 9 review, item 2): the Undo is a queued void that names the tap by
// key until the tap's answer gives the id. It is in the queue file (a kill keeps it), the match shows the tap taken back
// with a line, and the background sender sends the tap and then the void.

const UNDO = { kind: 'undo', key: 'u1', at: AT } as const;
const WAITING: QueuedEvent = {
  key: 'u1',
  type: 'core.void',
  payload: { event_id: '' },
  voidsKey: 'k1',
  rulesVersion: 1,
  createdAt: AT,
  attempts: 0,
};
const WAITING_FOR_K1: QueuedEvent = WAITING;
const SENT: QueuedEvent = { ...queuedOf('k1', rally('H')), attempts: 1 };

const padOf = (state: Parameters<typeof viewOf>[0]) => {
  const view = viewOf(state);
  if (view.kind !== 'pad') throw new Error(`expected the pad, got ${view.kind}`);
  return view;
};
/** The Undo asked, and the save it made landed, as the runner reports it. */
const askedAndSaved = (state: ReturnType<typeof ready>) =>
  step(step(state, UNDO, NOW).state, { kind: 'saved', n: 99 }, NOW).state;
const keysOf = (state: Parameters<typeof viewOf>[0]) =>
  state.sync.queue.pending.map((tap) => tap.key);

describe('Undo of a tap that may be at the server already', () => {
  it('is queued behind the tap, naming it by key, and saved at once', () => {
    const { state } = sentOnce();
    const asked = step(state, UNDO, NOW);
    expect(asked.outcome).toEqual({ ok: true });
    expect(asked.state.sync.queue.pending[1]).toEqual(WAITING);
    expect(keysOf(asked.state)).toEqual(['k1', 'u1']);
    const [save] = savesOf(asked.effects);
    expect(save.tap).toBe('u1');
    expect(save.queue?.pending.map((tap) => tap.voidsKey)).toEqual([undefined, 'k1']);
  });

  it('sends nothing of its own: the tap is the only send, and the Undo never the body', () => {
    const { state } = sentOnce();
    const asked = step(state, UNDO, NOW);
    expect(sendsOf(asked.effects)).toEqual([]);
    const saved = step(asked.state, { kind: 'saved', n: 99 }, NOW);
    expect(sendsOf(saved.effects)).toEqual([]);
  });

  it('shows the tap taken back, and the line says the Undo is waiting to send', () => {
    const { state } = sentOnce();
    expect(padOf(state).view.halves.map((half) => half.value)).toEqual(['1', '0']);
    const asked = padOf(step(state, UNDO, NOW).state);
    expect(asked.view.halves.map((half) => half.value)).toEqual(['0', '0']);
    expect(asked.line).toEqual({ kind: 'note', key: 'scoring.pad.undoWaiting' });
  });

  it('shows the server’s copy of the tap taken back too, when a ping brought it in before the answer', () => {
    const { state } = sentOnce();
    const asked = step(state, UNDO, NOW).state;
    const copy = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const merged = step(asked, { kind: 'fetched', events: copy }, NOW).state;
    expect(padOf(merged).view.halves.map((half) => half.value)).toEqual(['0', '0']);
    expect(keysOf(merged)).toEqual(['k1', 'u1']);
  });

  it('twice takes back two things: the second Undo reaches the event before, never the same tap again', () => {
    const ledger = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]);
    const base = ready({ ledger, queue: queueOf({ ownEventIds: ['ev-2'] }) });
    const { state } = sentOnceOn(base);
    const first = step(state, UNDO, NOW);
    const second = step(first.state, { ...UNDO, key: 'u2' }, NOW);
    expect(second.outcome).toEqual({ ok: true });
    expect(second.state.sync.queue.pending.map((tap) => [tap.key, tap.payload])).toEqual([
      ['k1', { wonBy: 'ent-away' }],
      ['u1', { event_id: '' }],
      ['u2', { event_id: 'ev-2' }],
    ]);
  });

  it('with a tap made while it waits: that tap is folded on the match as it shows, and queued after the Undo', () => {
    const { state } = sentOnce();
    const asked = step(state, UNDO, NOW).state;
    const next = step(
      asked,
      { kind: 'tap', tap: { kind: 'rally', side: 'second' }, key: 'k2', at: AT },
      NOW,
    );
    expect(next.outcome).toEqual({ ok: true });
    expect(keysOf(next.state)).toEqual(['k1', 'u1', 'k2']);
    expect(padOf(next.state).view.halves.map((half) => half.value)).toEqual(['0', '1']);
  });
});

/** Like `sentOnce` over another base: its one queued rally (`k1`) is sent and awaits its answer. */
function sentOnceOn(base: ReturnType<typeof ready>) {
  const queued: QueuedEvent = queuedOf('k1', rally('A'));
  const state = {
    ...base,
    sync: { ...base.sync, queue: { ...base.sync.queue, pending: [queued] } },
  };
  const read = step(state, { kind: 'fetched', events: [] }, NOW);
  const saved = step(read.state, { kind: 'saved', n: 99 }, NOW);
  return { state: saved.state, sent: sendsOf(read.effects)[0]?.sent };
}

describe('the answer to the tap an Undo waits for', () => {
  it('accepted: the Undo becomes a plain void of the id the answer names, saved, and then sent', () => {
    const { state, sent } = sentOnce();
    const asked = askedAndSaved(state);
    const answered = step(asked, { kind: 'answered', sent, answer: ACCEPTED }, NOW);
    expect(answered.state.sync.queue.pending).toEqual([
      {
        key: 'u1',
        type: 'core.void',
        payload: { event_id: 'srv-1' },
        rulesVersion: 1,
        createdAt: AT,
        attempts: 0,
      },
    ]);
    expect(sendsOf(answered.effects)).toEqual([]);
    expect(savesOf(answered.effects)).toHaveLength(1);
    const saved = step(answered.state, { kind: 'saved', n: 99 }, NOW);
    const [send] = sendsOf(saved.effects);
    expect(send.body).toMatchObject({
      idempotency_key: 'u1',
      type: 'core.void',
      payload: { event_id: 'srv-1' },
      expected_seq: 2,
    });
  });

  it('accepted, then the void accepted: sent once, the queue empty, and nothing is sent again', () => {
    const { state, sent } = sentOnce();
    const asked = askedAndSaved(state);
    const answered = step(asked, { kind: 'answered', sent, answer: ACCEPTED }, NOW);
    const saved = step(answered.state, { kind: 'saved', n: 99 }, NOW);
    const voidSent = sendsOf(saved.effects)[0].sent;
    const done = step(
      saved.state,
      {
        kind: 'answered',
        sent: voidSent,
        answer: { kind: 'accepted', seq: 3, eventId: 'srv-2', rulesVersion: 1 },
      },
      NOW,
    );
    expect(done.state.sync.queue.pending).toEqual([]);
    expect(done.state.sync.ledger.map((event) => event.type)).toEqual([
      'core.start',
      'badminton.rally',
      'core.void',
    ]);
    expect(sendsOf(step(done.state, { kind: 'tick' }, NOW + 60_000).effects)).toEqual([]);
    expect(padOf(done.state).view.halves.map((half) => half.value)).toEqual(['0', '0']);
  });

  it('refused: the Undo goes with the tap, nothing is sent for it', () => {
    const { state, sent } = sentOnce();
    const asked = step(state, UNDO, NOW).state;
    const refused = step(
      asked,
      { kind: 'answered', sent, answer: { kind: 'refused', status: 422, code: 'X' } },
      NOW,
    );
    expect(refused.state.sync.queue.pending).toEqual([]);
    expect(savesOf(refused.effects)[0].queue?.pending).toEqual([]);
  });

  it('accepted when another scorer has already voided the tap: no second void', () => {
    const { state, sent } = sentOnce();
    const asked = step(state, UNDO, NOW).state;
    const brought = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }, voiding(2)]).slice(1);
    const merged = step(asked, { kind: 'fetched', events: brought }, NOW).state;
    const answer = { kind: 'accepted', seq: 2, eventId: 'ev-2', rulesVersion: 1 } as const;
    const answered = step(merged, { kind: 'answered', sent, answer }, NOW);
    expect(answered.state.sync.queue.pending).toEqual([]);
  });

  it('a link that dies first: the tap and the Undo are kept in the dead queue', () => {
    const { state, sent } = sentOnce();
    const asked = step(state, UNDO, NOW).state;
    const dead = step(
      asked,
      { kind: 'answered', sent, answer: { kind: 'linkDead', code: 'LINK_REVOKED' } },
      NOW,
    );
    expect(keysOf(dead.state)).toEqual(['k1', 'u1']);
    expect(dead.state.sync.queue.dead).toBe('LINK_REVOKED');
  });

  it('a conflict first: both stay queued, the tap is sent again, and the Undo is still waiting for it', () => {
    const { state, sent } = sentOnce();
    const asked = step(state, UNDO, NOW).state;
    const conflict = step(
      asked,
      { kind: 'answered', sent, answer: { kind: 'seqConflict', currentSeq: null } },
      NOW,
    );
    expect(keysOf(conflict.state)).toEqual(['k1', 'u1']);
    expect(conflict.state.sync.queue.pending[1].voidsKey).toBe('k1');
  });
});

describe('an Undo that waits, after the app has been left', () => {
  it('is kept through a kill: reopened from the file it sends the tap first, never the Undo', () => {
    const queue = queueOf({ pending: [SENT, WAITING] });
    const reopened = opened({ queue });
    const read = step(reopened, { kind: 'fetched', events: [] }, NOW);
    expect(keysOf(read.state)).toEqual(['k1', 'u1']);
    const saved = step(read.state, { kind: 'saved', n: 99 }, NOW);
    const sends = [...sendsOf(read.effects), ...sendsOf(saved.effects)];
    expect(sends.map((send) => send.body.idempotency_key)).toEqual(['k1']);
  });

  it('is sent by the background sender too: the tap, then the void it was resolved into, with no fold', () => {
    const queue = queueOf({ pending: [SENT, WAITING] });
    const state = opened({ queue, judge: 'trust', bootstrap: null });
    const read = step(state, { kind: 'fetched', events: [] }, NOW);
    const first = sendsOf(read.effects)[0];
    expect(first.body.idempotency_key).toBe('k1');
    const marked = step(read.state, { kind: 'saved', n: 99 }, NOW).state;
    const answered = step(marked, { kind: 'answered', sent: first.sent, answer: ACCEPTED }, NOW);
    expect(answered.state.sync.queue.pending.map((tap) => [tap.key, tap.payload])).toEqual([
      ['u1', { event_id: 'srv-1' }],
    ]);
    const saved = step(answered.state, { kind: 'saved', n: 99 }, NOW);
    expect(sendsOf(saved.effects).map((send) => send.body.idempotency_key)).toEqual(['u1']);
  });

  it('is not dropped by a judgement of the queue on a changed ledger: the tap and the Undo are judged as one', () => {
    const queue = queueOf({ pending: [{ ...SENT, attempts: 0 }, WAITING] });
    const state = opened({ queue });
    const other = ledgerOf([start(), rally('A', 'A')]).slice(1);
    const read = step(state, { kind: 'fetched', events: other }, NOW);
    expect(keysOf(read.state)).toEqual(['k1', 'u1']);
    expect(read.state.sync.queue.pending[1].voidsKey).toBe('k1');
  });

  it('judged behind a head, the pair counts for nothing: a tap after it is judged as if neither was there', () => {
    // 41 rallies to the home side: the 42nd would decide the match. k1 (the 42nd) is taken back by u1, so k3 is the
    // 42nd and legal; folded with k1 counted, k3 would be a rally after the match is decided, and be dropped.
    const base = [start(), ...rallies('H'.repeat(41))];
    const queue = queueOf({
      pending: [
        queuedOf('k0', rally('A')),
        { ...queuedOf('k1', rally('H')), attempts: 1 },
        WAITING,
        queuedOf('k3', rally('H')),
      ],
    });
    const state = opened({ queue }, base);
    const more = ledgerOf([...base, rally('A', 'A')]).slice(base.length);
    const read = step(state, { kind: 'fetched', events: more }, NOW);
    expect(keysOf(read.state)).toEqual(['k0', 'k1', 'u1', 'k3']);
  });

  it('whose tap has gone from the queue is nothing now, and is dropped', () => {
    const queue = queueOf({ pending: [WAITING] });
    const read = step(opened({ queue }), { kind: 'fetched', events: [] }, NOW);
    expect(read.state.sync.queue.pending).toEqual([]);
  });
});

describe('the queue as the fold counts it', () => {
  it('leaves out a tap an Undo waits on and the Undo, until the ledger holds the tap’s copy', () => {
    const { state } = sentOnce([WAITING_FOR_K1]);
    expect(foldQueue(state).map((tap) => tap.key)).toEqual([]);
  });

  it('stands the Undo in as a void of the copy’s id once the ledger holds it, and the tap is left out', () => {
    const { state } = sentOnce([WAITING_FOR_K1]);
    const copy = ledgerOf([start(), { ...rally('H'), link: PHONE_LINK }]).slice(1);
    const merged = step(state, { kind: 'fetched', events: copy }, NOW).state;
    expect(foldQueue(merged).map((tap) => [tap.key, tap.payload])).toEqual([
      ['u1', { event_id: 'ev-2' }],
    ]);
  });

  it('keeps every other tap in its place', () => {
    const { state } = sentOnce([WAITING_FOR_K1, queuedOf('k2', rally('A'))]);
    expect(foldQueue(state).map((tap) => tap.key)).toEqual(['k2']);
  });
});

describe('asking for the Undo of a tap that waits', () => {
  it('replaces a refusal line and an old “undone” line: the line now is the Undo’s own note', () => {
    const { state } = sentOnce();
    const noisy: typeof state = {
      ...state,
      line: { kind: 'refusal', key: 'scoring.refusal.notNow' },
      undone: { tap: { kind: 'rally', side: 'first' }, over: 'stale' },
    };
    const asked = step(noisy, UNDO, NOW).state;
    expect(asked.line).toBeNull();
    expect(asked.undone).toBeNull();
  });
});

describe('a match closed while an Undo waits', () => {
  it('shows the match as it stands, with Undo off', () => {
    const { state } = sentOnce();
    const asked = step(state, UNDO, NOW).state;
    const closed = step(
      asked,
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status: 'finalized' } },
      NOW,
    );
    expect(step(closed.state, { ...UNDO, key: 'u2' }, NOW).outcome).toEqual({
      ok: false,
      refusal: 'notNow',
    });
  });
});

describe('the others’ taps', () => {
  it('a co-scorer’s identical rally does not stand in for the tap: the Undo is still the tap’s own', () => {
    const { state } = sentOnce();
    const asked = step(state, UNDO, NOW).state;
    const theirs = ledgerOf([start(), { ...rally('H'), link: BROWSER_LINK }]).slice(1);
    const merged = step(asked, { kind: 'fetched', events: theirs }, NOW).state;
    expect(padOf(merged).view.halves.map((half) => half.value)).toEqual(['1', '0']);
    expect(keysOf(merged)).toEqual(['k1', 'u1']);
  });
});

void tapped;
