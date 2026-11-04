import { describe, expect, it } from 'vitest';
import { rowsKey, scoringHome, type QueueRow } from '@/domain/mode/scoringHome';
import type { SavedCode } from '@/domain/mode/savedCode';
import type { MatchQueue, QueuedEvent, QueueDead } from '@/domain/scoring/queue';

const tap = (key: string): QueuedEvent => ({
  key,
  type: 'core.rally',
  payload: {},
  rulesVersion: 1,
  createdAt: '2026-11-02T09:00:00.000Z',
  attempts: 0,
});
const queue = (
  fixtureId: string,
  taps: number,
  over: { label?: string; dead?: QueueDead | null; askedAbout?: readonly string[] } = {},
): QueueRow => {
  const value: MatchQueue = {
    fixtureId,
    label: over.label ?? `Label of ${fixtureId}`,
    pending: Array.from({ length: taps }, (_, i) => tap(`${fixtureId}-${i}`)),
    ownEventIds: [],
    dead: over.dead ?? null,
    ...(over.askedAbout === undefined ? {} : { askedAbout: over.askedAbout }),
  };
  return { kind: 'queue', queue: value };
};
const unreadable = (fixtureId: string): QueueRow => ({ kind: 'unreadable', fixtureId });

const saved = (fixtureId: string, label: string): SavedCode => ({
  mode: 'scoring',
  raw: '',
  slot: null,
  savedAt: new Date('2026-11-02T09:00:00Z'),
  expiresAt: null,
  stream: null,
  scoring: { fixtureId, label },
});

/**
 * What Home's Remote Scoring cards say (design §5, ruling 29; plan S2-1 Task 10): the saved match with its unsent
 * count, then every other match's queue that still holds taps: live ones counted, dead ones and unreadable ones with
 * Dismiss. Written out by hand; the cards' words are the UI's.
 */
describe('scoringHome', () => {
  it('has nothing to say with no match saved and no queue', () => {
    expect(scoringHome(null, [])).toEqual({ current: null, leftovers: [] });
  });

  it('names the saved match and counts its unsent taps', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 3)]).current).toEqual({
      fixtureId: 'fx-4',
      label: 'Match 4',
      unsent: 3,
      state: 'live',
      finished: null,
    });
  });

  it('a saved match with no queue file has nothing unsent', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), []).current).toEqual({
      fixtureId: 'fx-4',
      label: 'Match 4',
      unsent: 0,
      state: 'live',
      finished: null,
    });
  });

  it('takes the name from the saved code, not the queue file, which may be older', () => {
    const home = scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 1, { label: 'Old name' })]);
    expect(home.current?.label).toBe('Match 4');
  });

  it('is dead when its queue can send no more, and says how many taps wait', () => {
    expect(
      scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 2, { dead: 'LINK_REVOKED' })]).current,
    ).toEqual({ fixtureId: 'fx-4', label: 'Match 4', unsent: 2, state: 'dead', finished: null });
  });

  it('a dead queue with nothing in it is not dead news', () => {
    expect(
      scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 0, { dead: 'finalized' })]).current,
    ).toEqual({ fixtureId: 'fx-4', label: 'Match 4', unsent: 0, state: 'live', finished: null });
  });

  it('is unreadable when its queue file cannot be read: the count is unknown', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), [unreadable('fx-4')]).current).toEqual({
      fixtureId: 'fx-4',
      label: 'Match 4',
      unsent: 0,
      state: 'unreadable',
      finished: null,
    });
  });

  it('lists the other matches that still hold taps, live and dead, in the store’s order', () => {
    const home = scoringHome(saved('fx-4', 'Match 4'), [
      queue('fx-1', 2, { label: 'Match 1' }),
      queue('fx-2', 4, { label: 'Match 2', dead: 'forbidden' }),
      queue('fx-4', 1),
    ]);
    expect(home.leftovers).toEqual([
      { kind: 'live', fixtureId: 'fx-1', label: 'Match 1', unsent: 2 },
      { kind: 'dead', fixtureId: 'fx-2', label: 'Match 2', unsent: 4 },
    ]);
  });

  it('lists an unreadable queue of another match, which the store could not read', () => {
    expect(scoringHome(null, [unreadable('fx-9')]).leftovers).toEqual([
      { kind: 'unreadable', fixtureId: 'fx-9' },
    ]);
  });

  it('leaves out a queue with nothing in it, dead or not: there is nothing to send and nothing to tell', () => {
    const home = scoringHome(null, [queue('fx-1', 0), queue('fx-2', 0, { dead: 'LINK_REVOKED' })]);
    expect(home.leftovers).toEqual([]);
  });

  it('with no match saved, every queue with taps is a leftover (the match was replaced or forgotten)', () => {
    const home = scoringHome(null, [queue('fx-1', 1, { label: 'Match 1' })]);
    expect(home.current).toBeNull();
    expect(home.leftovers).toEqual([
      { kind: 'live', fixtureId: 'fx-1', label: 'Match 1', unsent: 1 },
    ]);
  });

  it('a saved code of another mode is no match', () => {
    const stream: SavedCode = { ...saved('fx-4', 'Match 4'), mode: 'stream', scoring: null };
    expect(scoringHome(stream, []).current).toBeNull();
  });
});

describe('scoringHome, which row is the saved match’s', () => {
  it('finds the saved match’s own queue wherever it is listed, and counts nothing of the others in it', () => {
    const home = scoringHome(saved('fx-2', 'Match 2'), [queue('fx-1', 5), queue('fx-2', 2)]);
    expect(home.current).toEqual({
      fixtureId: 'fx-2',
      label: 'Match 2',
      unsent: 2,
      state: 'live',
      finished: null,
    });
    expect(home.leftovers).toEqual([
      { kind: 'live', fixtureId: 'fx-1', label: 'Label of fx-1', unsent: 5 },
    ]);
  });

  it('has no saved match when the saved code is Live Stream’s, even one that carries a scoring part', () => {
    const odd: SavedCode = { ...saved('fx-2', 'Match 2'), mode: 'stream' };
    expect(scoringHome(odd, [queue('fx-2', 2)])).toEqual({
      current: null,
      leftovers: [{ kind: 'live', fixtureId: 'fx-2', label: 'Label of fx-2', unsent: 2 }],
    });
  });
});

/**
 * A finished match (owner ruling 41, 2026-11-02): the saved match is over and every tap of this phone has reached the
 * server. Only then does its card say so and offer Close; taps still unsent keep the count and no Close, and a match
 * the phone cannot read stays a plain Continue (the decision is the files', never a guess).
 */
describe('scoringHome, a finished match', () => {
  const over = { fixtureId: 'fx-4', score: '21–15, 21–18' };

  it('is finished when the match is over and nothing is unsent, with its score', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 0)], over).current).toEqual({
      fixtureId: 'fx-4',
      label: 'Match 4',
      unsent: 0,
      state: 'live',
      finished: { score: '21–15, 21–18' },
    });
  });

  it('is finished with no queue file at all: another scorer may have taken every tap', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), [], over).current?.finished).toEqual({
      score: '21–15, 21–18',
    });
  });

  it('is finished when its queue says finalized with nothing left in it', () => {
    const rows = [queue('fx-4', 0, { dead: 'finalized' })];
    expect(scoringHome(saved('fx-4', 'Match 4'), rows, over).current?.finished).toEqual({
      score: '21–15, 21–18',
    });
  });

  it('is not finished while taps are unsent: the count stands, and Close waits for the server', () => {
    const current = scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 2)], over).current;
    expect(current?.finished).toBeNull();
    expect(current?.unsent).toBe(2);
  });

  it('is not finished when its unsent taps can never go: that card says so and offers Dismiss', () => {
    const rows = [queue('fx-4', 2, { dead: 'LINK_REVOKED' })];
    const current = scoringHome(saved('fx-4', 'Match 4'), rows, over).current;
    expect(current?.finished).toBeNull();
    expect(current?.state).toBe('dead');
  });

  // Task 8d follow-up (controller, 2026-11-04). A result that stands is the server's: taps the phone still holds for it
  // were refused or will never be taken, and are not part of what Home says. Close asks before it discards them.
  it.each(['finalized', 'carriedForward'] as const)(
    'is finished though its %s queue still holds unsent taps: the server’s result, not “1 tap not sent”',
    (dead) => {
      const rows = [queue('fx-4', 1, { dead })];
      expect(scoringHome(saved('fx-4', 'Match 4'), rows, over).current).toEqual({
        fixtureId: 'fx-4',
        label: 'Match 4',
        unsent: 1,
        state: 'dead',
        finished: { score: '21–15, 21–18' },
      });
    },
  );

  it('is not finished when the dead queue is on a cancelled match, whatever it was told', () => {
    const rows = [queue('fx-4', 1, { dead: 'cancelled' })];
    expect(scoringHome(saved('fx-4', 'Match 4'), rows, over).current?.finished).toBeNull();
  });

  it('is not finished when the held taps are waiting for the scorer’s answer', () => {
    const rows = [queue('fx-4', 1, { askedAbout: ['ev-9'] })];
    expect(scoringHome(saved('fx-4', 'Match 4'), rows, over).current?.finished).toBeNull();
  });

  it('is not finished when its queue cannot be read: what is unsent is unknown', () => {
    const current = scoringHome(saved('fx-4', 'Match 4'), [unreadable('fx-4')], over).current;
    expect(current?.finished).toBeNull();
    expect(current?.state).toBe('unreadable');
  });

  it('is not finished when nothing says so: a match the phone cannot judge is Continue', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 0)], null).current?.finished).toBe(
      null,
    );
    expect(scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 0)]).current?.finished).toBe(null);
  });

  it('does not borrow another match’s result: it says finished only of the saved match', () => {
    const other = { fixtureId: 'fx-9', score: '21–0' };
    expect(
      scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 0)], other).current?.finished,
    ).toBeNull();
  });

  it('says nothing of it with no saved match', () => {
    expect(scoringHome(null, [], over)).toEqual({ current: null, leftovers: [] });
  });
});

describe('rowsKey', () => {
  it('is the same for the same cards and differs when a count, a name, a dead word or a kind moves', () => {
    const base = [queue('fx-1', 2, { label: 'Match 1' }), unreadable('fx-2')];
    expect(rowsKey(base)).toBe(
      rowsKey([queue('fx-1', 2, { label: 'Match 1' }), unreadable('fx-2')]),
    );
    expect(rowsKey(base)).not.toBe(
      rowsKey([queue('fx-1', 1, { label: 'Match 1' }), unreadable('fx-2')]),
    );
    expect(rowsKey(base)).not.toBe(
      rowsKey([queue('fx-1', 2, { label: 'Match 9' }), unreadable('fx-2')]),
    );
    expect(rowsKey(base)).not.toBe(
      rowsKey([queue('fx-1', 2, { label: 'Match 1', dead: 'gone' }), unreadable('fx-2')]),
    );
    expect(rowsKey(base)).not.toBe(
      rowsKey([queue('fx-1', 2, { label: 'Match 1' }), queue('fx-2', 0)]),
    );
    expect(rowsKey([])).toBe('');
  });
});

// The reconnect question (owner ruling 43; round 4, item 6): a queue held for the scorer's answer sends nothing, so Home
// does not call it sending. It is its own state, until the scorer answers on the pad.
describe('scoringHome, a queue held for the scorer’s answer', () => {
  const held = { askedAbout: ['ev-9'] };

  it('is asked on the saved match, with its unsent count', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 2, held)]).current).toEqual({
      fixtureId: 'fx-4',
      label: 'Match 4',
      unsent: 2,
      state: 'asked',
      finished: null,
    });
  });

  it('is asked on another match’s queue: a leftover of its own kind', () => {
    const home = scoringHome(null, [queue('fx-1', 3, { ...held, label: 'Match 1' })]);
    expect(home.leftovers).toEqual([
      { kind: 'asked', fixtureId: 'fx-1', label: 'Match 1', unsent: 3 },
    ]);
  });

  it('a dead link comes first: the question is moot there, and what is told is that the taps can never go', () => {
    const own = scoringHome(saved('fx-4', 'Match 4'), [
      queue('fx-4', 2, { ...held, dead: 'LINK_REVOKED' }),
    ]);
    expect(own.current?.state).toBe('dead');
    const other = scoringHome(null, [queue('fx-1', 1, { ...held, dead: 'finalized' })]);
    expect(other.leftovers.map((leftover) => leftover.kind)).toEqual(['dead']);
  });

  it('a question marker with no tap left is nothing: live and no card', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 0, held)]).current?.state).toBe(
      'live',
    );
    expect(scoringHome(null, [queue('fx-1', 0, held)]).leftovers).toEqual([]);
  });

  it('an empty list of events is no question', () => {
    const home = scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 2, { askedAbout: [] })]);
    expect(home.current?.state).toBe('live');
  });

  it('is a change of cards: the key moves when a queue becomes held, and stays when it is held about more', () => {
    const plain = rowsKey([queue('fx-4', 2)]);
    const one = rowsKey([queue('fx-4', 2, { askedAbout: ['ev-9'] })]);
    const two = rowsKey([queue('fx-4', 2, { askedAbout: ['ev-9', 'ev-10'] })]);
    expect(one).not.toBe(plain);
    expect(two).toBe(one);
  });
});
