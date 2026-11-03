import { describe, expect, it } from 'vitest';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { undoEventFor, undoTarget } from '@/domain/scoring/undoTarget';
import { voidTargetOf, type LedgerEvent } from '@/domain/scoring/wire';

// Ruling 28 (design §6.2, plan S2-1 Task 7): Undo takes back this phone's latest own event, queued first, then the
// ledger's, only while nothing from another device stands after it; a start only while nothing at all follows it. "Own"
// is the ids the server returned for this phone's taps (`ownEventIds`), never the device link: a browser on the same
// link shares it. A tap whose send may have reached the server cannot be deleted from the queue (`canDiscardQueued`):
// Undo waits for its answer and voids the id it returns.

const PHONE_LINK = 'link-phone';

/** A ledger event; another device's unless the test lists its id as this phone's own. */
function event(
  seq: number,
  type: string,
  more: { readonly voids?: string; readonly link?: string | null } = {},
): LedgerEvent {
  return {
    id: `ev-${seq}`,
    seq,
    type,
    payload: more.voids === undefined ? {} : { event_id: more.voids },
    recordedAt: `2026-11-01T10:00:${String(seq).padStart(2, '0')}.000Z`,
    voids: more.voids ?? null,
    deviceLinkId: more.link === undefined ? 'link-browser' : more.link,
  };
}

const rally = (seq: number, more?: { readonly link?: string | null }) =>
  event(seq, 'badminton.rally', more);
const voiding = (seq: number, target: number) => event(seq, 'core.void', { voids: `ev-${target}` });

function tap(key: string, type: string, payload: unknown = {}): QueuedEvent {
  return {
    key,
    type,
    payload,
    rulesVersion: 1,
    createdAt: '2026-11-01T10:05:00.000Z',
    attempts: 0,
  };
}

const anyTap = () => true;
const noTap = () => false;

describe('undoTarget: nothing to take back', () => {
  it('blocks with nothing on an empty match', () => {
    expect(undoTarget([], [], [], anyTap)).toEqual({ kind: 'blocked', reason: 'nothing' });
  });

  it('blocks with nothing when every event is another device’s', () => {
    const ledger = [event(1, 'core.start'), rally(2)];
    expect(undoTarget(ledger, [], [], anyTap)).toEqual({ kind: 'blocked', reason: 'nothing' });
  });

  it('never takes back a void: with its one rally undone, this phone has nothing left to take back', () => {
    const ledger = [event(1, 'core.start'), rally(2), voiding(3, 2)];
    expect(undoTarget(ledger, [], ['ev-2', 'ev-3'], anyTap)).toEqual({
      kind: 'blocked',
      reason: 'nothing',
    });
  });
});

describe('undoTarget: the queue first', () => {
  it('takes the last queued tap, which nothing can follow', () => {
    const ledger = [event(1, 'core.start'), rally(2)];
    const queued = [tap('k1', 'badminton.rally'), tap('k2', 'badminton.rally')];
    expect(undoTarget(ledger, queued, [], anyTap)).toEqual({ kind: 'queued', key: 'k2' });
  });

  it('waits for the answer of a queued tap whose send may have reached the server', () => {
    const queued = [tap('k1', 'core.start'), tap('k2', 'badminton.rally')];
    expect(undoTarget([], queued, [], noTap)).toEqual({ kind: 'awaitAnswer', key: 'k2' });
  });

  it('asks the queue’s own rule about the tap it picked, and no other', () => {
    const asked: string[] = [];
    const queued = [tap('k1', 'core.start'), tap('k2', 'badminton.rally')];
    undoTarget([], queued, [], (key) => {
      asked.push(key);
      return true;
    });
    expect(asked).toEqual(['k2']);
  });

  // A queued undo takes its target out of the match: the next Undo steps back past both (a second call).
  it('steps back past a ledger tap a queued void already takes back', () => {
    const ledger = [event(1, 'core.start'), rally(2), rally(3)];
    const queued = [tap('v1', 'core.void', { event_id: 'ev-3' })];
    expect(undoTarget(ledger, queued, ['ev-2', 'ev-3'], anyTap)).toEqual({
      kind: 'ledger',
      eventId: 'ev-2',
    });
  });
});

describe('undoTarget: the ledger', () => {
  it('takes this phone’s last event when it stands last', () => {
    const ledger = [event(1, 'core.start'), rally(2), rally(3)];
    expect(undoTarget(ledger, [], ['ev-2', 'ev-3'], anyTap)).toEqual({
      kind: 'ledger',
      eventId: 'ev-3',
    });
  });

  it('is blocked once another scorer’s rally stands after this phone’s last', () => {
    const ledger = [event(1, 'core.start'), rally(2), rally(3)];
    expect(undoTarget(ledger, [], ['ev-2'], anyTap)).toEqual({
      kind: 'blocked',
      reason: 'otherScorer',
    });
  });

  it('is open again once the other scorer’s later rally is voided', () => {
    const ledger = [event(1, 'core.start'), rally(2), rally(3), voiding(4, 3)];
    expect(undoTarget(ledger, [], ['ev-2'], anyTap)).toEqual({ kind: 'ledger', eventId: 'ev-2' });
  });

  it('steps back past a tap this phone already took back in the ledger', () => {
    const ledger = [event(1, 'core.start'), rally(2), rally(3), voiding(4, 3)];
    expect(undoTarget(ledger, [], ['ev-2', 'ev-3', 'ev-4'], anyTap)).toEqual({
      kind: 'ledger',
      eventId: 'ev-2',
    });
  });

  // Task 9 additions: own events are keyed on `ownEventIds`. The stand-in sync adds for an accepted tap has no device
  // link and the phone's clock; the server's copy of a browser's tap on the same link carries this phone's link.
  it('reads own from the ids, never the device link', () => {
    const standIn = rally(2, { link: null });
    const sameLink = rally(3, { link: PHONE_LINK });
    expect(undoTarget([event(1, 'core.start'), standIn], [], ['ev-2'], anyTap)).toEqual({
      kind: 'ledger',
      eventId: 'ev-2',
    });
    expect(undoTarget([event(1, 'core.start'), standIn, sameLink], [], ['ev-2'], anyTap)).toEqual({
      kind: 'blocked',
      reason: 'otherScorer',
    });
  });
});

describe('undoTarget: the start', () => {
  it('takes a start that nothing follows, queued or in the ledger', () => {
    expect(undoTarget([], [tap('s', 'core.start')], [], noTap)).toEqual({
      kind: 'awaitAnswer',
      key: 's',
    });
    expect(undoTarget([event(1, 'core.start')], [], ['ev-1'], anyTap)).toEqual({
      kind: 'ledger',
      eventId: 'ev-1',
    });
  });

  it('is blocked once anything follows it, a rally Undo already took back included', () => {
    const ledger = [event(1, 'core.start'), rally(2), voiding(3, 2)];
    expect(undoTarget(ledger, [], ['ev-1', 'ev-2', 'ev-3'], anyTap)).toEqual({
      kind: 'blocked',
      reason: 'startFollowed',
    });
  });

  it('is blocked by a queued tap behind it that a queued void takes back', () => {
    const ledger = [event(1, 'core.start'), rally(2)];
    const queued = [tap('v', 'core.void', { event_id: 'ev-2' })];
    expect(undoTarget(ledger, queued, ['ev-1', 'ev-2'], anyTap)).toEqual({
      kind: 'blocked',
      reason: 'startFollowed',
    });
  });

  it('says another scorer, not the start, when another device’s rally stands after it', () => {
    const ledger = [event(1, 'core.start'), rally(2)];
    expect(undoTarget(ledger, [], ['ev-1'], anyTap)).toEqual({
      kind: 'blocked',
      reason: 'otherScorer',
    });
  });

  it('takes this phone’s rally after another device’s start', () => {
    const ledger = [event(1, 'core.start'), rally(2)];
    expect(undoTarget(ledger, [], ['ev-2'], anyTap)).toEqual({ kind: 'ledger', eventId: 'ev-2' });
  });
});

describe('undoEventFor', () => {
  it('takes back a recorded event with a core.void naming it, as the web reads a void', () => {
    const undo = undoEventFor('ev-3');
    expect(undo).toEqual({ type: 'core.void', payload: { event_id: 'ev-3' } });
    expect(voidTargetOf(undo.type, undo.payload)).toBe('ev-3');
  });
});
