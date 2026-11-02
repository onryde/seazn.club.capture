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
  over: { label?: string; dead?: QueueDead | null } = {},
): QueueRow => {
  const value: MatchQueue = {
    fixtureId,
    label: over.label ?? `Label of ${fixtureId}`,
    pending: Array.from({ length: taps }, (_, i) => tap(`${fixtureId}-${i}`)),
    ownEventIds: [],
    dead: over.dead ?? null,
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
    });
  });

  it('a saved match with no queue file has nothing unsent', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), []).current).toEqual({
      fixtureId: 'fx-4',
      label: 'Match 4',
      unsent: 0,
      state: 'live',
    });
  });

  it('takes the name from the saved code, not the queue file, which may be older', () => {
    const home = scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 1, { label: 'Old name' })]);
    expect(home.current?.label).toBe('Match 4');
  });

  it('is dead when its queue can send no more, and says how many taps wait', () => {
    expect(
      scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 2, { dead: 'LINK_REVOKED' })]).current,
    ).toEqual({ fixtureId: 'fx-4', label: 'Match 4', unsent: 2, state: 'dead' });
  });

  it('a dead queue with nothing in it is not dead news', () => {
    expect(
      scoringHome(saved('fx-4', 'Match 4'), [queue('fx-4', 0, { dead: 'finalized' })]).current,
    ).toEqual({ fixtureId: 'fx-4', label: 'Match 4', unsent: 0, state: 'live' });
  });

  it('is unreadable when its queue file cannot be read: the count is unknown', () => {
    expect(scoringHome(saved('fx-4', 'Match 4'), [unreadable('fx-4')]).current).toEqual({
      fixtureId: 'fx-4',
      label: 'Match 4',
      unsent: 0,
      state: 'unreadable',
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
