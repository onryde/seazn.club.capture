import { describe, expect, it } from 'vitest';
import { sportFor } from '@/domain/scoring/sports';
import { tennisSport } from '@/domain/scoring/tennisSport';
import { display } from '@/domain/scoring/tennisFold.testkit';
import {
  GRAND_SLAM_CFG,
  SINGLES,
  abandon,
  forfeit,
  judgedLedgerOf,
  point,
  start,
  summary,
  withCfg,
} from '../../../test/tennisLedger';
import { gamesOf } from '@/domain/scoring/tennisFold.testkit';

// S2-7 Task 8: the sport module over the real fold. Every expectation is written out from the spec.

describe('tennisSport', () => {
  it('is listed by the bootstrap’s sport key, and no other key finds it', () => {
    expect(sportFor('tennis')).toBe(tennisSport);
    expect(sportFor('tennisx')).toBeNull();
    expect(tennisSport.key).toBe('tennis');
  });

  it('folds a ledger through the engine, with History rows (memoised on the same input)', () => {
    const input = {
      bootstrap: SINGLES,
      ledger: judgedLedgerOf(SINGLES, [start(), point('H')]),
      queued: [],
      ownEventIds: [],
      toss: null,
    };
    const a = tennisSport.fold(input);
    expect(a.kind).toBe('folded');
    if (a.kind !== 'folded') return;
    expect(a.history[0]?.rows).toHaveLength(2);
    expect(tennisSport.fold(input)).toBe(a);
    expect(tennisSport.fold({ ...input, ledger: [...input.ledger] })).toBe(a);
  });

  it('a different ledger is folded afresh (the memo is not sticky)', () => {
    const base = { bootstrap: SINGLES, queued: [], ownEventIds: [], toss: null };
    const a = tennisSport.fold({ ...base, ledger: judgedLedgerOf(SINGLES, [start()]) });
    const b = tennisSport.fold({ ...base, ledger: judgedLedgerOf(SINGLES, [start(), point('H')]) });
    expect(b).not.toBe(a);
    if (a.kind === 'folded' && b.kind === 'folded') {
      expect([a.display.call.first, b.display.call.first]).toEqual(['0', '15']);
    }
  });

  it('answers unfoldable for a match with an empty seat (an empty input)', () => {
    const result = tennisSport.fold({
      bootstrap: { ...SINGLES, sides: { home: SINGLES.sides.home, away: null } },
      ledger: [],
      queued: [],
      ownEventIds: [],
      toss: null,
    });
    expect(result).toEqual({ kind: 'unfoldable', reason: 'sides' });
  });

  it('keeps the side a toss names as the Start pick, and no other tap carries one (ruling 233)', () => {
    expect(tennisSport.tossOf({ kind: 'toss', side: 'second' })).toBe('second');
    expect(tennisSport.tossOf({ kind: 'toss', side: 'first' })).toBe('first');
    expect(tennisSport.tossOf({ kind: 'start' })).toBeNull();
    expect(tennisSport.tossOf({ kind: 'point', side: 'first' })).toBeNull();
  });

  it('refuses a set score as invalid, any other tap as not now', () => {
    expect(tennisSport.refusalFor({ kind: 'setScore', first: 9, second: 0, tb: null })).toBe(
      'invalidScore',
    );
    expect(tennisSport.refusalFor({ kind: 'point', side: 'first' })).toBe('notNow');
    expect(tennisSport.refusalFor({ kind: 'award', side: 'first' })).toBe('notNow');
  });

  it('knows the phases: not started, under way, decided, and ended by the organiser', () => {
    const fresh = display([]);
    expect([tennisSport.notStarted(fresh), tennisSport.decided(fresh)]).toEqual([true, false]);
    const live = display([start(), point('H')]);
    expect([tennisSport.notStarted(live), tennisSport.decided(live)]).toEqual([false, false]);
    const won = display([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(tennisSport.decided(won)).toBe(true);
    const retired = display([start(), point('H'), forfeit('A', 'retired')]);
    expect(tennisSport.decided(retired)).toBe(true);
    const abandoned = display([start(), point('H'), abandon('rain')]);
    expect(tennisSport.decided(abandoned)).toBe(true);
    expect(tennisSport.awaitingEnding(won)).toBe(false);
    expect(tennisSport.awaitingEnding(retired)).toBe(false);
  });

  it('the result line is the sets as written, space-joined, a tie-break set with its loser’s points', () => {
    const shown = display([
      start(),
      summary(7, 6, { home: 7, away: 5 }),
      ...gamesOf('AAAAAA'),
      ...gamesOf('HHHHHH'),
    ]);
    expect(tennisSport.resultLine(shown)).toBe('7–6(5) 0–6 6–0');
    expect(tennisSport.resultLine(display([]))).toBe('');
  });

  it('the result line of a match tie-break decider is the points in brackets', () => {
    const cfg = withCfg(SINGLES, {
      ...GRAND_SLAM_CFG,
      bestOf: 3,
      finalSet: { matchTiebreakTo: 10 },
    });
    const bootstrap = cfg;
    const shown = display([start(), summary(6, 4), summary(4, 6), summary(10, 7)], { bootstrap });
    expect(tennisSport.resultLine(shown)).toBe('6–4 4–6 [10–7]');
  });

  it('names an Undo’d tap, never the start, never an Undo twice, and shows it', () => {
    expect(tennisSport.undoneOf(display([start()]))).toBeNull();
    const pointed = display([start(), point('A')]);
    const tap = tennisSport.undoneOf(pointed);
    expect(tap).toMatchObject({ kind: 'point', side: 'second' });
    if (tap === null) return;
    const shown = tennisSport.showUndone(pointed, tap);
    expect(shown.lastTap?.kind).toBe('undone');
    expect(tennisSport.undoneOf(shown)).toBeNull();
  });

  it('an organiser’s ending is never an Undo’d tap', () => {
    expect(
      tennisSport.undoneOf(display([start(), point('H'), forfeit('A', 'retired')])),
    ).toBeNull();
  });

  it('draws the pad for the display', () => {
    const view = tennisSport.pad(display([]), { kind: 'synced' });
    expect(view.halves).toHaveLength(2);
  });
});
