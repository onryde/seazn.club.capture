import { describe, expect, it } from 'vitest';
import { deadOf } from '@/domain/scoring/scoringMatchState';
import { step, wakeAt } from '@/domain/scoring/scoringMatch';
import { viewOf } from '@/domain/scoring/scoringMatchView';
import { PHONE_LINK, SINGLES, queuedOf, rally, start } from '../../../test/badmintonLedger';
import { AT, NOW, kinds, opened, queueOf, ready } from '../../../test/scoringMatchFixtures';

// When the bootstrap is read again (plan S2-1 Task 9 review, items 1 and 9): the ledger cannot say a match was
// finalized (a staff reopen leaves an active core.finalize in it), so a decided match asks the bootstrap again on a
// ledger read, paced; a card (not started, view only) and a link with no bootstrap yet are polled every 15 s.

const PACE = 15_000;
/** Two games to one side: the match is decided. */
const DECIDED = [start(), ...Array.from({ length: 42 }, () => rally('H'))];
const UNDO = { kind: 'undo', key: 'u1', at: AT } as const;

describe('a decided match', () => {
  it('reads the bootstrap with the ledger on a ping, unless it was read within 15 s', () => {
    const state = ready({}, DECIDED);
    const ping = step(state, { kind: 'read' }, NOW + PACE);
    expect(kinds(ping.effects)).toEqual(['fetch', 'loadBootstrap']);
  });

  it('a ping inside the 15 s reads the ledger only, and owes the bootstrap for when they are over', () => {
    const state = ready({}, DECIDED);
    const ping = step(state, { kind: 'read' }, NOW + 1000);
    expect(kinds(ping.effects)).toEqual(['fetch']);
    expect(ping.state.bootstrapOwed).toBe(true);
    expect(wakeAt(ping.state, NOW + 1000)).toBe(NOW + PACE);
  });

  it('a storm of pings inside the window still owes one read, not one each', () => {
    let state = ready({}, DECIDED);
    for (let i = 1; i <= 5; i += 1) {
      const ping = step(state, { kind: 'read' }, NOW + i * 1000);
      expect(kinds(ping.effects)).toEqual(['fetch']);
      state = ping.state;
    }
    const due = step(state, { kind: 'tick' }, NOW + PACE);
    expect(kinds(due.effects)).toEqual(['loadBootstrap']);
    expect(due.state.bootstrapOwed).toBe(false);
    expect(kinds(step(due.state, { kind: 'tick' }, NOW + PACE + 1).effects)).toEqual([]);
  });

  it('a match still in play reads the bootstrap on no ping', () => {
    const state = ready({}, [start(), rally('H')]);
    expect(kinds(step(state, { kind: 'read' }, NOW + PACE).effects)).toEqual(['fetch']);
  });

  it('once finalized, its bootstrap closes the match to this phone: view only, and Undo is off', () => {
    const own = [...DECIDED.slice(0, -1), { ...rally('H'), link: PHONE_LINK }];
    // This phone's deciding tap opened Undo's window at NOW (owner, 2026-11-03), so only the finalizing closes it here.
    const state = ready({ queue: queueOf({ ownEventIds: ['ev-43'] }), decidedAt: NOW }, own);
    expect(step(state, UNDO, NOW).outcome).toEqual({ ok: true });
    const read = step(
      state,
      { kind: 'bootstrapRead', bootstrap: { ...SINGLES, status: 'finalized' } },
      NOW,
    );
    expect(deadOf(read.state)).toBe('finalized');
    const view = viewOf(read.state);
    expect(view.kind === 'pad' && view.view.card).toEqual({ kind: 'viewOnly' });
    const undo = step(read.state, UNDO, NOW);
    expect(undo.outcome).toEqual({ ok: false, refusal: 'notNow' });
    expect(undo.state.sync.queue.pending).toEqual([]);
  });

  it('is read again after the foreground returns, as a ping is', () => {
    const state = ready({}, DECIDED);
    const away = step(state, { kind: 'background' }, NOW).state;
    const back = step(away, { kind: 'foreground' }, NOW + PACE);
    expect(kinds(back.effects)).toEqual(['fetch', 'loadBootstrap']);
  });

  it('the background sender never reads it: it judges nothing', () => {
    const state = ready({ judge: 'trust' }, DECIDED);
    expect(kinds(step(state, { kind: 'read' }, NOW + PACE).effects)).toEqual(['fetch']);
    expect(wakeAt(step(state, { kind: 'read' }, NOW + 1000).state, NOW + 1000)).toBeNull();
  });
});

describe('a card over the pad', () => {
  const NOT_STARTED = { ...SINGLES, screen: 'divisionNotStarted' } as const;

  it('has the bootstrap read again every 15 s, whether or not anything pings', () => {
    const state = ready({ bootstrap: NOT_STARTED });
    expect(wakeAt(state, NOW)).toBe(NOW + PACE);
    expect(kinds(step(state, { kind: 'tick' }, NOW + PACE - 1).effects)).toEqual([]);
    const due = step(state, { kind: 'tick' }, NOW + PACE);
    expect(kinds(due.effects)).toEqual(['loadBootstrap']);
    expect(wakeAt(due.state, NOW + PACE)).toBe(NOW + 2 * PACE);
  });

  it('reads it on a ping at once, as it did before the poll', () => {
    const state = ready({ bootstrap: NOT_STARTED });
    expect(kinds(step(state, { kind: 'read' }, NOW + 1000).effects)).toEqual([
      'fetch',
      'loadBootstrap',
    ]);
  });

  it('is polled no more once the match starts and the pad shows', () => {
    const state = ready({ bootstrap: NOT_STARTED });
    const read = step(state, { kind: 'bootstrapRead', bootstrap: SINGLES }, NOW + 2000);
    expect(wakeAt(read.state, NOW + 2000)).toBeNull();
  });

  it('is not polled in the background, nor by the background sender', () => {
    const state = ready({ bootstrap: NOT_STARTED });
    expect(wakeAt(step(state, { kind: 'background' }, NOW).state, NOW)).toBeNull();
    expect(wakeAt(ready({ bootstrap: NOT_STARTED, judge: 'trust' }), NOW)).toBeNull();
  });
});

describe('no bootstrap yet', () => {
  it('is asked for again every 15 s while none is held, as a link that could not be read is', () => {
    const state = opened({ bootstrap: null });
    expect(wakeAt(state, NOW)).toBe(NOW + PACE);
    const failed = step(
      state,
      { kind: 'bootstrapFailed', failure: { kind: 'offline' } },
      NOW + 1000,
    );
    expect(wakeAt(failed.state, NOW + 1000)).toBe(NOW + PACE);
    expect(kinds(step(failed.state, { kind: 'tick' }, NOW + PACE).effects)).toEqual([
      'loadBootstrap',
    ]);
  });
});

describe('a bootstrap read that comes late', () => {
  const read = (state: ReturnType<typeof ready>, lastSeq: number, status: string) =>
    step(state, { kind: 'bootstrapRead', bootstrap: { ...SINGLES, lastSeq, status } }, NOW);

  it('is dropped when it is older than the one already applied: a stale in-play never reopens a finalized match', () => {
    const closed = read(ready(), 7, 'finalized').state;
    expect(deadOf(closed)).toBe('finalized');
    const stale = read(closed, 5, 'in_play');
    expect(stale.state.bootstrap).toBe(closed.bootstrap);
    expect(stale.effects).toEqual([]);
    expect(deadOf(stale.state)).toBe('finalized');
  });

  it('is applied when it is as new as the one held: a staff reopen leaves the ledger as it was', () => {
    const closed = read(ready(), 7, 'finalized').state;
    const reopened = read(closed, 7, 'in_play');
    expect(deadOf(reopened.state)).toBeNull();
  });

  it('is applied when none is held: the first read of a match', () => {
    const state = opened({ bootstrap: null });
    expect(read(state, 3, 'in_play').state.bootstrap?.lastSeq).toBe(3);
  });
});

describe('the bootstrap poll', () => {
  it('is not asked for by a dead queue, nor one too large to read: nothing it could say changes what is shown', () => {
    const card = opened({ bootstrap: { ...SINGLES, screen: 'divisionNotStarted' } });
    const asked = { ...card, bootstrapAskedAt: NOW };
    expect(wakeAt(asked, NOW)).toBe(NOW + 15_000);
    const dead = {
      ...asked,
      sync: { ...asked.sync, queue: { ...asked.sync.queue, dead: 'LINK_REVOKED' as const } },
    };
    expect(wakeAt(dead, NOW)).toBeNull();
    const large = { ...asked, sync: { ...asked.sync, status: 'tooLarge' as const } };
    expect(wakeAt(large, NOW)).toBeNull();
  });

  it('is not asked for by a runner that judges nothing, whatever its state says', () => {
    const trust = opened({ judge: 'trust', bootstrap: null });
    expect(wakeAt({ ...trust, bootstrapAskedAt: NOW }, NOW)).toBeNull();
    const ticked = step({ ...trust, bootstrapAskedAt: NOW }, { kind: 'tick' }, NOW + 20_000);
    expect(kinds(ticked.effects)).not.toContain('loadBootstrap');
  });
});

// The bootstrap again on a foreground and on a people sheet (S2-6 Task 3, ruling 181): a lineup saved on the web after
// the pad opened reaches the next people list, through the same 15 s pace, never on a ping (Realtime nudges those).
describe('the bootstrap again, for the people lists', () => {
  const PLAYING = [start(), rally('H')];
  const playing = () => ready({}, PLAYING);
  /** `ready` opened the match at NOW, which asked the bootstrap then. */
  const back = (state: ReturnType<typeof playing>, at: number) =>
    step(step(state, { kind: 'background' }, at - 1).state, { kind: 'foreground' }, at);

  it('a foreground 15 000 ms after the last ask asks, and one at 14 999 does not', () => {
    expect(kinds(back(playing(), NOW + PACE).effects)).toEqual(['fetch', 'loadBootstrap']);
    expect(kinds(back(playing(), NOW + PACE - 1).effects)).toEqual(['fetch']);
  });

  it('two foregrounds in one window ask once, and the ask moves the window', () => {
    const first = back(playing(), NOW + PACE);
    expect(kinds(first.effects)).toEqual(['fetch', 'loadBootstrap']);
    expect(first.state.bootstrapAskedAt).toBe(NOW + PACE);
    const second = back(first.state, NOW + PACE + 5000);
    expect(kinds(second.effects)).toEqual(['fetch']);
  });

  it('a read never asks it for a match in play: Realtime nudges, the people lists ask on their own', () => {
    expect(kinds(step(playing(), { kind: 'read' }, NOW + PACE).effects)).toEqual(['fetch']);
  });

  it('a people sheet asks it, paced, and only the ledger-free bootstrap: no fetch with it', () => {
    const open = step(playing(), { kind: 'peopleSheet' }, NOW + PACE);
    expect(kinds(open.effects)).toEqual(['loadBootstrap']);
    expect(open.state.bootstrapAskedAt).toBe(NOW + PACE);
    expect(kinds(step(open.state, { kind: 'peopleSheet' }, NOW + PACE + 1).effects)).toEqual([]);
  });

  it('a people sheet 1 ms inside the window asks nothing', () => {
    expect(kinds(step(playing(), { kind: 'peopleSheet' }, NOW + PACE - 1).effects)).toEqual([]);
  });

  it('the background sender never asks, on a foreground or a people sheet', () => {
    const state = ready({ judge: 'trust' }, PLAYING);
    expect(kinds(step(state, { kind: 'foreground' }, NOW + PACE).effects)).toEqual(['fetch']);
    expect(kinds(step(state, { kind: 'peopleSheet' }, NOW + PACE).effects)).toEqual([]);
  });

  it('a dead queue asks nothing on either', () => {
    const state = ready({ queue: queueOf({ dead: 'finalized' }) }, PLAYING);
    expect(kinds(step(state, { kind: 'foreground' }, NOW + PACE).effects)).toEqual([]);
    expect(kinds(step(state, { kind: 'peopleSheet' }, NOW + PACE).effects)).toEqual([]);
  });
});

// A re-read that drops a person the match already names (S2-6 Task 3): the engine refuses a ledger naming someone who is
// not on a sheet, so the pad would turn into an unfoldable card for a lineup saved after the first tap. The held row
// stays for a person the ledger or a queued tap names; a person nothing names goes with the new sheet.
describe('a bootstrap re-read that drops a person the match names', () => {
  const DROPPING = {
    ...SINGLES,
    sides: {
      home: { ...SINGLES.sides.home!, lineup: [], members: [] },
      away: SINGLES.sides.away,
    },
  };
  const named = (id: string) => ({
    type: 'badminton.rally',
    payload: { wonBy: 'ent-home', server: id },
  });
  const homeRows = (state: ReturnType<typeof ready>) =>
    state.bootstrap?.sides.home?.lineup.map((row) => row.personId);
  const homeMembers = (state: ReturnType<typeof ready>) =>
    state.bootstrap?.sides.home?.members.map((member) => member.personId);

  it('keeps the held row and member of a person the ledger names, and drops one nothing names', () => {
    const held = SINGLES.sides.home!.lineup[0]!.personId;
    const state = ready({}, [start(), named(held)]);
    const read = step(state, { kind: 'bootstrapRead', bootstrap: DROPPING }, NOW);
    expect(homeRows(read.state)).toEqual([held]);
    expect(homeMembers(read.state)).toEqual([held]);
    const quiet = step(
      ready({}, [start(), rally('H')]),
      { kind: 'bootstrapRead', bootstrap: DROPPING },
      NOW,
    );
    expect(homeRows(quiet.state)).toEqual([]);
    expect(homeMembers(quiet.state)).toEqual([]);
  });

  it('keeps one a queued tap names', () => {
    const held = SINGLES.sides.home!.lineup[0]!.personId;
    const tapped = { ...queuedOf('k1', named(held)) };
    const state = ready({ queue: queueOf({ pending: [tapped] }) }, [start()]);
    const read = step(state, { kind: 'bootstrapRead', bootstrap: DROPPING }, NOW);
    expect(homeRows(read.state)).toEqual([held]);
  });

  it('carries nothing over to a side that is another entrant now', () => {
    const held = SINGLES.sides.home!.lineup[0]!.personId;
    const state = ready({}, [start(), named(held)]);
    const reseated = {
      ...DROPPING,
      sides: { ...DROPPING.sides, home: { ...DROPPING.sides.home, entrantId: 'ent-other' } },
    };
    const read = step(state, { kind: 'bootstrapRead', bootstrap: reseated }, NOW);
    expect(homeRows(read.state)).toEqual([]);
  });

  it('adds nothing when the new sheet keeps everyone, and nothing on the first read', () => {
    const first = step(
      { ...ready({}, [start()]), bootstrap: null },
      { kind: 'bootstrapRead', bootstrap: SINGLES },
      NOW,
    );
    expect(first.state.bootstrap).toEqual(SINGLES);
    const same = step(
      ready({}, [start(), named(SINGLES.sides.home!.lineup[0]!.personId)]),
      { kind: 'bootstrapRead', bootstrap: SINGLES },
      NOW,
    );
    expect(same.state.bootstrap?.sides.home).toEqual(SINGLES.sides.home);
  });
});
