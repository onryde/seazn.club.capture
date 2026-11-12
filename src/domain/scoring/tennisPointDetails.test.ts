import { describe, expect, it } from 'vitest';
import { tennisEventFor, tennisPayloadForSend } from '@/domain/scoring/tennisEvents';
import { display, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import {
  POINT_DETAILS_HOLD_MS,
  chipOf,
  chipTools,
  pointChips,
  withPointKind,
} from '@/domain/scoring/tennisPointDetails';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY,
  DOUBLES,
  HOME,
  SINGLES,
  award,
  ledgerOf,
  point,
  queuedOf,
  start,
  summary,
  toss,
  type Spec,
} from '../../../test/tennisLedger';

// S2-7 ruling 234 (Task 17): the point details. With the scorer's "Point details" switch on, a point is held unsent for a
// moment while the chips show (the web holds for HOLD_MS_DEFAULT, 10 000 ms: apps/web/src/components/v2/scorepad/queue.ts:150)
// and carries `server` when the engine names the server; a chip adds `meta.kind`, one of the engine's point kinds
// (`NestedPointKind`: ace, double_fault, winner, ue; dist/sports/nested/kernel.js:118). An ace is the server's point and a
// double fault the receiver's (the web's `buildDock`, tennis.tsx); Winner and Error are any side's. Every expected value
// below is written out from the engine's schema, the fixture's ids and the spec.

const SEND = { bootstrap: null, ownEventIds: [] };

function detailed(
  specs: readonly Spec[],
  side: 'first' | 'second',
  bootstrap: Bootstrap = SINGLES,
) {
  return tennisEventFor(
    { kind: 'point', side, details: true },
    { bootstrap, display: display(specs, { bootstrap }) },
  );
}

describe('the hold', () => {
  it('is the web’s 10 s', () => {
    expect(POINT_DETAILS_HOLD_MS).toBe(10_000);
  });
});

describe('a detailed point, as the event queued', () => {
  it('names the singles server (home serves the first game), held, at the count of serve events standing', () => {
    expect(detailed([start()], 'second')).toEqual({
      type: 'tennis.point',
      payload: { by: AWAY, server: 'h1' },
      base: 0,
      hold: 10_000,
    });
  });

  it('names the server the toss named, and the other once a game is played', () => {
    expect(detailed([toss('A'), start()], 'first')?.payload).toEqual({ by: HOME, server: 'a1' });
    expect(detailed([start(), ...gamesOf('H')], 'first')).toEqual({
      type: 'tennis.point',
      payload: { by: HOME, server: 'a1' },
      base: 4,
      hold: 10_000,
    });
  });

  it('counts an award game as a serve event, since it moves the serve', () => {
    expect(detailed([start(), point('H'), award('A')], 'first')).toEqual({
      type: 'tennis.point',
      payload: { by: HOME, server: 'a1' },
      base: 2,
      hold: 10_000,
    });
  });

  it('names the doubles server from the pair order', () => {
    expect(detailed([start()], 'first', DOUBLES)?.payload).toEqual({ by: HOME, server: 'h1' });
  });

  it('names no doubles server in a tie-break (the engine pins the partner who opened the turn)', () => {
    const tiebreak = [start(), ...gamesOf('HAHAHAHAHAHA')];
    expect(display(tiebreak, { bootstrap: DOUBLES }).breaker).toBe('tiebreak');
    expect(detailed(tiebreak, 'first', DOUBLES)?.payload).toEqual({ by: HOME });
  });

  it('names a singles server in a tie-break: the side serving is exact there', () => {
    const tiebreak = [start(), ...gamesOf('HAHAHAHAHAHA')];
    expect(detailed(tiebreak, 'first')?.payload).toEqual({ by: HOME, server: 'h1' });
  });

  it('names no server when the engine cannot name the order (a set score of an odd number of games)', () => {
    const odd = [start(), summary(6, 3)];
    expect(display(odd).serving).toBeNull();
    expect(detailed(odd, 'first')?.payload).toEqual({ by: HOME });
  });

  it('is the plain point, sent at once, with the details off (ruling 217 kept)', () => {
    const plain = tennisEventFor(
      { kind: 'point', side: 'first' },
      { bootstrap: SINGLES, display: display([start()]) },
    );
    expect(plain).toEqual({ type: 'tennis.point', payload: { by: HOME } });
  });
});

describe('the chips a point offers', () => {
  it('offers Ace, Winner and Error on the server’s point, in the engine’s order', () => {
    expect(pointChips(display([start()]).serving, 'first')).toEqual(['ace', 'winner', 'ue']);
  });

  it('offers Double fault, Winner and Error on the receiver’s point', () => {
    expect(pointChips(display([start()]).serving, 'second')).toEqual([
      'double_fault',
      'winner',
      'ue',
    ]);
  });

  it('follows the toss: away serving, an away point may be an ace', () => {
    expect(pointChips(display([toss('A'), start()]).serving, 'second')).toEqual([
      'ace',
      'winner',
      'ue',
    ]);
  });

  it('offers neither Ace nor Double fault when the engine names no server', () => {
    expect(pointChips(null, 'first')).toEqual(['winner', 'ue']);
  });

  it('draws each chip as a tool of its own, the error said in full', () => {
    expect(chipTools(['double_fault', 'winner', 'ue'])).toEqual([
      {
        id: 'chip.double_fault',
        label: { key: 'scoring.tennis.chip.doubleFault' },
        detail: null,
        kind: 'standard',
        enabled: true,
      },
      {
        id: 'chip.winner',
        label: { key: 'scoring.tennis.chip.winner' },
        detail: null,
        kind: 'standard',
        enabled: true,
      },
      {
        id: 'chip.ue',
        label: { key: 'scoring.tennis.chip.error' },
        said: { key: 'scoring.tennis.chip.errorSaid' },
        detail: null,
        kind: 'standard',
        enabled: true,
      },
    ]);
    expect(chipTools(['ace'])[0].label).toEqual({ key: 'scoring.tennis.chip.ace' });
  });

  it('reads a chip back from its tool id, and nothing from any other tool', () => {
    expect(chipOf('chip.ace')).toBe('ace');
    expect(chipOf('chip.ue')).toBe('ue');
    expect(chipOf('violation')).toBeNull();
    expect(chipOf('chip.let')).toBeNull();
    expect(chipOf('tool.ace')).toBeNull();
  });
});

describe('a chip on the held point', () => {
  it('adds meta.kind and keeps the rest', () => {
    expect(withPointKind({ by: HOME, server: 'h1' }, 'ace')).toEqual({
      by: HOME,
      server: 'h1',
      meta: { kind: 'ace' },
    });
  });

  it('keeps a meta field already there', () => {
    expect(withPointKind({ by: AWAY, meta: { receiverSide: 'ad' } }, 'winner')).toEqual({
      by: AWAY,
      meta: { receiverSide: 'ad', kind: 'winner' },
    });
  });
});

describe('the send of a detailed point', () => {
  const TAGGED = { by: HOME, server: 'h1', meta: { kind: 'ace' } };
  const tagged = (base?: number) => ({
    ...queuedOf('k1', { type: 'tennis.point', payload: TAGGED }),
    ...(base === undefined ? {} : { base }),
  });

  it('goes as queued when the serve events standing are the ones it was made at', () => {
    expect(tennisPayloadForSend(tagged(1), ledgerOf([start(), point('A')]), false, SEND)).toEqual(
      TAGGED,
    );
  });

  it('goes as the side alone when another scorer’s point landed first (the server and the kind were judged on another point)', () => {
    const moved = ledgerOf([start(), point('A'), point('H')]);
    expect(tennisPayloadForSend(tagged(1), moved, false, SEND)).toEqual({ by: HOME });
  });

  it('goes as queued while the ledger holds its copy (the server matches a resend by key)', () => {
    const moved = ledgerOf([start(), point('A'), point('H')]);
    expect(tennisPayloadForSend(tagged(1), moved, true, SEND)).toEqual(TAGGED);
  });

  it('goes as queued with no count to judge by (a plain point)', () => {
    const moved = ledgerOf([start(), point('A'), point('H')]);
    expect(tennisPayloadForSend(tagged(), moved, false, SEND)).toEqual(TAGGED);
  });
});
