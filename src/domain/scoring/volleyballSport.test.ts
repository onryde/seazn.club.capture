import { describe, expect, it } from 'vitest';
import { sportFor } from '@/domain/scoring/sports';
import { volleyballSport } from '@/domain/scoring/volleyballSport';
import { INDOOR, judgedLedgerOf, rally, start, wholeSet } from '../../../test/volleyballLedger';
import { displayOf } from './volleyballPad.testkit';

// S2-6 Task 8: the sport module over the real fold. Every expectation is written out from the spec.

describe('volleyballSport', () => {
  it('is listed by the bootstrap’s sport key, and no other key finds it', () => {
    expect(sportFor('volleyball')).toBe(volleyballSport);
    expect(sportFor('volleyballx')).toBeNull();
    expect(volleyballSport.key).toBe('volleyball');
  });

  it('folds a ledger through the engine, with History rows (memoised on the same input)', () => {
    const input = {
      bootstrap: INDOOR,
      ledger: judgedLedgerOf(INDOOR, [start(), rally({ wonBy: 'H', serving: 'H' })]),
      queued: [],
      ownEventIds: [],
      toss: null,
    };
    const a = volleyballSport.fold(input);
    expect(a.kind).toBe('folded');
    if (a.kind !== 'folded') return;
    expect(a.history).toHaveLength(1);
    expect(volleyballSport.fold(input)).toBe(a);
  });

  it('answers unfoldable for a match with an empty seat (an empty input)', () => {
    const result = volleyballSport.fold({
      bootstrap: { ...INDOOR, sides: { home: INDOOR.sides.home, away: null } },
      ledger: [],
      queued: [],
      ownEventIds: [],
      toss: null,
    });
    expect(result).toEqual({ kind: 'unfoldable', reason: 'sides' });
  });

  it('reads the Start pick, and every other tap carries none', () => {
    expect(volleyballSport.tossOf({ kind: 'start', server: 'second' })).toBe('second');
    expect(volleyballSport.tossOf({ kind: 'timeout', side: 'first' })).toBeNull();
  });

  it('refuses a set score as invalid, any other tap as not now', () => {
    expect(volleyballSport.refusalFor({ kind: 'setScore', first: 99, second: 0 })).toBe(
      'invalidScore',
    );
    expect(volleyballSport.refusalFor({ kind: 'timeout', side: 'first' })).toBe('notNow');
    expect(
      volleyballSport.refusalFor({
        kind: 'sanction',
        side: 'first',
        level: 'warning',
        person: null,
      }),
    ).toBe('notNow');
  });

  it('knows the phases: not started, under way, decided; and the result line of the sets over', () => {
    const fresh = displayOf([]);
    expect([volleyballSport.notStarted(fresh), volleyballSport.decided(fresh)]).toEqual([
      true,
      false,
    ]);
    const live = displayOf([start(), rally({ wonBy: 'H', serving: 'H' })]);
    expect([volleyballSport.notStarted(live), volleyballSport.decided(live)]).toEqual([
      false,
      false,
    ]);
    const decided = displayOf([start(), wholeSet(25, 20), wholeSet(25, 18), wholeSet(25, 22)]);
    expect(volleyballSport.decided(decided)).toBe(true);
    expect(volleyballSport.resultLine(decided)).toBe('25–20, 25–18, 25–22');
    expect(volleyballSport.resultLine(fresh)).toBe('');
    expect(volleyballSport.awaitingEnding(decided)).toBe(false);
  });

  it('names an Undo’d tap, never the start, never an Undo twice, and shows it', () => {
    const none = displayOf([start()]);
    expect(volleyballSport.undoneOf(none)).toBeNull();
    const timed = displayOf([start(), { type: 'volleyball.timeout', payload: { by: 'ent-home' } }]);
    const tap = volleyballSport.undoneOf(timed);
    expect(tap).toEqual({ kind: 'timeout', side: 'first' });
    if (tap === null) return;
    const shown = volleyballSport.showUndone(timed, tap);
    expect(shown.lastTap).toEqual({ kind: 'undone', tap: { kind: 'timeout', side: 'first' } });
    expect(volleyballSport.undoneOf(shown)).toBeNull();
  });

  it('draws the pad for the display', () => {
    const view = volleyballSport.pad(displayOf([]), { kind: 'synced' });
    expect(view.halves).toHaveLength(2);
  });
});
