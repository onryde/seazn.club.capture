import { describe, expect, it } from 'vitest';
import { openMatch, step } from '@/domain/scoring/scoringMatch';
import type { MatchEvent } from '@/domain/scoring/scoringMatchState';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import {
  PHONE_LINK,
  eventId,
  ledgerOf,
  rallies,
  rally,
  sanction,
  start,
  type Spec,
} from '../../../test/badmintonLedger';
import { AT, held, queueOf, ready } from '../../../test/scoringMatchFixtures';

// Owner, 2026-11-03: Undo closes 30 s after a match is decided by this phone's own tap. The start of the window is the
// reducer's: it is the DISPATCHED tap that makes the match decided, read off the state before and after the step, never
// off a frame the pad happened to show. It is kept on the state (`decidedAt`, ms on the phone's clock), handed in when a
// match opens (the hub keeps it between screens) and asked of an Undo, which a closed window refuses. Every time below
// is written out; the only clock is the `now` each step is given.

/** A match one rally from the end: game one 21-0, game two 20-0. The next rally for the first side decides it. */
const ONE_TO_GO: readonly Spec[] = [start(), ...rallies(`${'H'.repeat(21)}${'H'.repeat(20)}`)];
const DECIDING = { kind: 'tap', tap: { kind: 'rally', side: 'first' }, key: 'k1', at: AT } as const;
const UNDO: MatchEvent = { kind: 'undo', key: 'u1', at: AT };

const T = 5_000_000;
const decidedAt = (state: ReturnType<typeof ready>) => state.decidedAt;
const cardKind = (state: ReturnType<typeof ready>) => {
  const view = viewOf(state);
  return view.kind === 'pad' ? (view.view.card?.kind ?? null) : view.kind;
};

/** The 43rd event of the ledger: the rally that decides the match, as another scorer's phone made it. */
const OTHER_SCORERS_RALLY = ledgerOf([...ONE_TO_GO, rally('H')]).slice(ONE_TO_GO.length);

/** The match decided by this phone's own tap at T. */
const decidedByThisPhone = () => step(ready({}, ONE_TO_GO), DECIDING, T).state;

describe('where the Undo window starts', () => {
  it('is the clock of the dispatched tap that decides the match', () => {
    const state = decidedByThisPhone();
    expect(cardKind(state)).toBe('resultRecorded');
    expect(decidedAt(state)).toBe(T);
  });

  it('is nothing before the match is decided: a rally in play, and the match as it is opened', () => {
    const playing = ready({}, [start(), ...rallies('HAH')]);
    expect(decidedAt(playing)).toBeNull();
    const rallied = step(playing, DECIDING, T).state;
    expect(cardKind(rallied)).toBeNull();
    expect(decidedAt(rallied)).toBeNull();
  });

  // A match that comes up decided (a restart, a rescan, a screen opened late) has no tap of this launch to date it from.
  it('is nothing for a match that was already decided when it opened', () => {
    const opened = ready({}, [...ONE_TO_GO, rally('H')]);
    expect(cardKind(opened)).toBe('resultRecorded');
    expect(decidedAt(opened)).toBeNull();
  });

  it('is nothing for a ledger read that decides the match: the other scorer’s rally is not this phone’s tap', () => {
    const state = ready({}, ONE_TO_GO);
    const read = step(state, { kind: 'fetched', events: OTHER_SCORERS_RALLY }, T);
    expect(cardKind(read.state)).toBe('resultRecorded');
    expect(decidedAt(read.state)).toBeNull();
  });

  // The ledger lands first, then the phone's own tap answers: neither the ledger nor the answer is the tap.
  it('is not moved by what comes after: the answer, the next ledger read, a tick, the clock going on', () => {
    const state = decidedByThisPhone();
    const later = step(state, { kind: 'tick' }, T + 20_000).state;
    const read = step(later, { kind: 'read' }, T + 21_000).state;
    const back = step(read, { kind: 'foreground' }, T + 22_000).state;
    expect(decidedAt(back)).toBe(T);
  });

  it('is not made again by a tap the decided match refuses', () => {
    const state = decidedByThisPhone();
    const again = step(state, { ...DECIDING, key: 'k2' }, T + 10_000);
    expect(again.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(decidedAt(again.state)).toBe(T);
  });

  it('is the ending that decides a disqualification, not the sanction that waits for it', () => {
    const waiting = ready({}, [
      start(),
      rally('H', 'H'),
      sanction('A', 'disqualification', 'p-chen'),
    ]);
    expect(decidedAt(waiting)).toBeNull();
    const ended = step(
      waiting,
      {
        kind: 'tap',
        tap: { kind: 'ending', side: 'second', person: 'L. Chen' },
        key: 'k9',
        at: AT,
      },
      T,
    ).state;
    expect(cardKind(ended)).toBe('resultRecorded');
    expect(decidedAt(ended)).toBe(T);
  });

  it('is not the sanction’s own tap that waits for its ending: that tap decides nothing', () => {
    const state = ready({}, [start(), rally('H', 'H')]);
    const tap = {
      kind: 'sanction',
      side: 'second',
      level: 'disqualification',
      person: 'p-chen',
    } as const;
    const sanctioned = step(state, { kind: 'tap', tap, key: 'k3', at: AT }, T).state;
    expect(decidedAt(sanctioned)).toBeNull();
  });
});

describe('a window the hub hands a match that opens', () => {
  it('is the start the match opens with, and it counts on from there', () => {
    const opened = openMatch(
      held({ ledger: ledgerOf([...ONE_TO_GO, rally('H')]), decidedAt: T }),
      T + 4_000,
    );
    expect(decidedAt(opened.state)).toBe(T);
  });

  it('is none for a match handed none', () => {
    expect(decidedAt(openMatch(held({ decidedAt: null }), T).state)).toBeNull();
  });
});

describe('Undo against the window', () => {
  it('is taken at the start, in the middle, and one millisecond before the window closes', () => {
    for (const gone of [0, 15_000, 29_999]) {
      const undone = step(decidedByThisPhone(), UNDO, T + gone);
      expect(undone.outcome).toEqual({ ok: true });
    }
  });

  it('is refused from the moment the window closes, and the match is left as it was', () => {
    const state = decidedByThisPhone();
    for (const gone of [30_000, 30_001, 600_000]) {
      const refused = step(state, UNDO, T + gone);
      expect(refused.outcome).toEqual({ ok: false, refusal: 'notNow' });
      expect(refused.state.sync.queue.pending).toEqual(state.sync.queue.pending);
      expect(decidedAt(refused.state)).toBe(T);
    }
  });

  // After a restart, a leave or a Dismiss the match is decided with no start: there is nothing to take back from.
  it('is refused on a decided match with no start at all', () => {
    // The deciding rally is this phone's own (its id is kept), as after a restart: Undo would find it, but for the window.
    const state = ready({ queue: queueOf({ ownEventIds: [eventId(43)] }) }, [
      ...ONE_TO_GO,
      { ...rally('H'), link: PHONE_LINK },
    ]);
    const refused = step(state, UNDO, T);
    expect(refused.outcome).toEqual({ ok: false, refusal: 'notNow' });
  });

  it('reopens the match and ends the window; the next decision starts a fresh one', () => {
    const undone = step(decidedByThisPhone(), UNDO, T + 10_000).state;
    expect(cardKind(undone)).toBeNull();
    expect(decidedAt(undone)).toBeNull();
    const again = step(undone, { ...DECIDING, key: 'k2' }, T + 25_000).state;
    expect(decidedAt(again)).toBe(T + 25_000);
    // The old window would be shut at T + 30 s; the new one is open at T + 40 s.
    expect(step(again, { ...UNDO, key: 'u2' }, T + 40_000).outcome).toEqual({ ok: true });
  });

  it('has no window at the end of a game, which Undo takes back at any time', () => {
    const gameOne = ready({}, [start(), ...rallies('H'.repeat(20))]);
    const ended = step(gameOne, DECIDING, T).state;
    expect(cardKind(ended)).toBeNull();
    expect(decidedAt(ended)).toBeNull();
    expect(step(ended, UNDO, T + 3_600_000).outcome).toEqual({ ok: true });
  });

  it('takes back a disqualification still waiting for its ending, at any time: nothing is decided yet', () => {
    const waiting = ready({ queue: queueOf({ ownEventIds: [eventId(3)] }) }, [
      start(),
      rally('H', 'H'),
      { ...sanction('A', 'disqualification', 'p-chen'), link: PHONE_LINK },
    ]);
    expect(step(waiting, { ...UNDO, only: 'ending' }, T + 3_600_000).outcome).toEqual({ ok: true });
  });

  // Undo took the deciding tap back, and the other scorer then decides: the result is theirs, and no window is opened.
  it('opens none when the other scorer decides the match after this phone’s Undo', () => {
    const undone = step(decidedByThisPhone(), UNDO, T + 5_000).state;
    const read = step(undone, { kind: 'fetched', events: OTHER_SCORERS_RALLY }, T + 8_000).state;
    expect(cardKind(read)).toBe('resultRecorded');
    expect(decidedAt(read)).toBeNull();
  });
});
