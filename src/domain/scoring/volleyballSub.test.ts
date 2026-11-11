import { describe, expect, it } from 'vitest';
import {
  backSub,
  chooseSub,
  startSub,
  subSheet,
  type SubStep,
} from '@/domain/scoring/volleyballSub';
import { volleyballPeopleOf, type VolleyballPeople } from '@/domain/scoring/volleyballPeople';
import { INDOOR } from '../../../test/volleyballLedger';
import { displayOf } from './volleyballPad.testkit';

// S2-6 Task 7: the Sub steps. People come from the real bootstrap seeds (INDOOR: seven players a side, a coach for home).

const people = volleyballPeopleOf(INDOOR);
const display = displayOf([]);
const nobody: VolleyballPeople = { first: [], second: [] };
const one: VolleyballPeople = {
  first: [{ personId: 'x', name: 'X', official: false }],
  second: people.second,
};

describe('volleyballSub: off, then on, then the sub', () => {
  it('goes side -> off -> on -> record, naming people by id', () => {
    const open = startSub('first', people);
    expect(open).toEqual({ kind: 'step', step: { step: 'off', side: 'first' } });
    const off = chooseSub((open as { step: SubStep }).step, 'h2', people);
    expect(off).toEqual({ kind: 'step', step: { step: 'on', side: 'first', off: 'h2' } });
    expect(chooseSub((off as { step: SubStep }).step, 'h7', people)).toEqual({
      kind: 'record',
      tap: { kind: 'sub', side: 'first', off: 'h2', on: 'h7' },
    });
  });

  it('lists the side’s players for both steps, a coach never, everyone who has left included', () => {
    const offSheet = subSheet({ step: 'off', side: 'first' }, people, display.sides);
    expect(offSheet.title).toEqual({ key: 'scoring.volleyball.sheet.off' });
    expect(offSheet.body).toBe('Falcons');
    expect(offSheet.options.map((o) => o.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']);
    expect(offSheet.options[0]).toEqual({ id: 'h1', label: 'Falcons h1', tone: 'standard' });
    const onSheet = subSheet({ step: 'on', side: 'first', off: 'h2' }, people, display.sides);
    expect(onSheet.title).toEqual({ key: 'scoring.volleyball.sheet.on' });
    expect(onSheet.body).toBe('Falcons h2');
    expect(onSheet.options.map((o) => o.id)).toEqual(['h1', 'h3', 'h4', 'h5', 'h6', 'h7']);
  });

  it('a side with no players, or one, is recorded as the side alone at once', () => {
    expect(startSub('first', nobody)).toEqual({
      kind: 'record',
      tap: { kind: 'sub', side: 'first' },
    });
    expect(startSub('first', one)).toEqual({ kind: 'record', tap: { kind: 'sub', side: 'first' } });
    const coachOnly: VolleyballPeople = {
      first: [{ personId: 'c', name: 'C', official: true }],
      second: [],
    };
    expect(startSub('first', coachOnly).kind).toBe('record');
  });

  it('a pair (beach players, exactly two) can still pair off: one comes off, the other on', () => {
    const pair: VolleyballPeople = {
      first: [
        { personId: 'p', name: 'P', official: false },
        { personId: 'q', name: 'Q', official: false },
      ],
      second: [],
    };
    const open = startSub('first', pair);
    expect(open.kind).toBe('step');
    expect(chooseSub({ step: 'on', side: 'first', off: 'p' }, 'q', pair)).toEqual({
      kind: 'record',
      tap: { kind: 'sub', side: 'first', off: 'p', on: 'q' },
    });
  });

  it('a choice the step does not offer, or a second press of one, leaves the step', () => {
    const off: SubStep = { step: 'off', side: 'first' };
    expect(chooseSub(off, 'nobody', people)).toEqual({ kind: 'step', step: off });
    expect(chooseSub(off, 'h-coach', people)).toEqual({ kind: 'step', step: off });
    expect(chooseSub(off, 'a1', people)).toEqual({ kind: 'step', step: off });
    const on: SubStep = { step: 'on', side: 'first', off: 'h2' };
    expect(chooseSub(on, 'h2', people)).toEqual({ kind: 'step', step: on });
    expect(chooseSub(on, 'a1', people)).toEqual({ kind: 'step', step: on });
    // a double press: the move from the same step with the same choice is the same move
    expect(chooseSub(off, 'h2', people)).toEqual(chooseSub(off, 'h2', people));
  });

  it('Back goes from on to off, and out of the sheet from off', () => {
    expect(backSub({ step: 'on', side: 'second', off: 'a3' })).toEqual({
      step: 'off',
      side: 'second',
    });
    expect(backSub({ step: 'off', side: 'second' })).toBeNull();
  });

  it('the away side’s people are its own (the other seat)', () => {
    expect(chooseSub({ step: 'off', side: 'second' }, 'a1', people)).toEqual({
      kind: 'step',
      step: { step: 'on', side: 'second', off: 'a1' },
    });
  });

  it('a person the sheet names a name for only: a row with no member is not offered', () => {
    const bare = {
      ...INDOOR,
      sides: {
        ...INDOOR.sides,
        home: { ...INDOOR.sides.home!, members: INDOOR.sides.home!.members.slice(0, 3) },
      },
    };
    expect(volleyballPeopleOf(bare).first.map((p) => p.personId)).toEqual(['h1', 'h2', 'h3']);
  });

  it('a match with an empty seat has nobody to offer', () => {
    expect(
      volleyballPeopleOf({ ...INDOOR, sides: { home: null, away: INDOOR.sides.away } }),
    ).toEqual(nobody);
  });
});
