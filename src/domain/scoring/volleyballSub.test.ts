import { describe, expect, it } from 'vitest';
import { chooseSub, startSub, subSheet, type SubStep } from '@/domain/scoring/volleyballSub';
import type { PadSide } from '@/domain/scoring/padView';
import type { VolleyballSwap } from '@/domain/scoring/volleyballTypes';
import { volleyballPeopleOf, type VolleyballPeople } from '@/domain/scoring/volleyballPeople';
import { INDOOR } from '../../../test/volleyballLedger';
import { displayOf } from './volleyballPad.testkit';

// S2-6 Task 7: the Sub steps. People come from the real bootstrap seeds (INDOOR: seven players a side, a coach for home).

const people = volleyballPeopleOf(INDOOR);
const display = displayOf([]);
const noSwaps: Readonly<Record<PadSide, readonly VolleyballSwap[]>> = { first: [], second: [] };
const nobody: VolleyballPeople = { first: [], second: [] };
const one: VolleyballPeople = {
  first: [{ personId: 'x', name: 'X', official: false, slot: null }],
  second: people.second,
};

describe('volleyballSub: off, then on, then the sub', () => {
  it('goes side -> off -> on -> record, naming people by id', () => {
    const open = startSub('first', people);
    expect(open).toEqual({ kind: 'step', step: { step: 'off', side: 'first' } });
    const off = chooseSub((open as { step: SubStep }).step, 'h2', people, noSwaps);
    expect(off).toEqual({ kind: 'step', step: { step: 'on', side: 'first', off: 'h2' } });
    expect(chooseSub((off as { step: SubStep }).step, 'h7', people, noSwaps)).toEqual({
      kind: 'record',
      tap: { kind: 'sub', side: 'first', off: 'h2', on: 'h7' },
    });
  });

  it('with nobody swapped: off lists the six starters, on the bench player; a coach never', () => {
    const offSheet = subSheet({ step: 'off', side: 'first' }, people, display.sides, noSwaps);
    expect(offSheet.title).toEqual({ key: 'scoring.volleyball.sheet.off' });
    expect(offSheet.body).toBe('Falcons');
    expect(offSheet.options.map((o) => o.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
    expect(offSheet.options[0]).toEqual({ id: 'h1', label: 'Falcons h1', tone: 'standard' });
    const onSheet = subSheet(
      { step: 'on', side: 'first', off: 'h2' },
      people,
      display.sides,
      noSwaps,
    );
    expect(onSheet.title).toEqual({ key: 'scoring.volleyball.sheet.on' });
    expect(onSheet.body).toBe('Falcons h2');
    expect(onSheet.options.map((o) => o.id)).toEqual(['h7']);
  });

  it('after h2 -> h7: off lists h7 in lineup order and not h2; on lists h2, who left, again', () => {
    const swaps = { first: [{ off: 'h2', on: 'h7' }], second: [] };
    const offSheet = subSheet({ step: 'off', side: 'first' }, people, display.sides, swaps);
    expect(offSheet.options.map((o) => o.id)).toEqual(['h1', 'h3', 'h4', 'h5', 'h6', 'h7']);
    const onSheet = subSheet(
      { step: 'on', side: 'first', off: 'h1' },
      people,
      display.sides,
      swaps,
    );
    expect(onSheet.options.map((o) => o.id)).toEqual(['h2']);
  });

  it('counts swaps across the match: h2 -> h7 then h7 -> h2 puts h2 back on court', () => {
    const swaps = {
      first: [
        { off: 'h2', on: 'h7' },
        { off: 'h7', on: 'h2' },
      ],
      second: [],
    };
    const offSheet = subSheet({ step: 'off', side: 'first' }, people, display.sides, swaps);
    expect(offSheet.options.map((o) => o.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  });

  it('the other side’s swaps do not move this side (the sets are per side)', () => {
    const offSheet = subSheet({ step: 'off', side: 'second' }, people, display.sides, {
      first: [{ off: 'h2', on: 'h7' }],
      second: [],
    });
    expect(offSheet.options.map((o) => o.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  it('a side with no starting rows (no team sheet) offers every player in both steps, a coach never', () => {
    const sheetless: VolleyballPeople = {
      first: [
        { personId: 'p', name: 'P', official: false, slot: null },
        { personId: 'q', name: 'Q', official: false, slot: null },
        { personId: 'r', name: 'R', official: false, slot: null },
        { personId: 'c', name: 'C', official: true, slot: null },
      ],
      second: [],
    };
    const offSheet = subSheet({ step: 'off', side: 'first' }, sheetless, display.sides, noSwaps);
    expect(offSheet.options.map((o) => o.id)).toEqual(['p', 'q', 'r']);
    const onSheet = subSheet(
      { step: 'on', side: 'first', off: 'q' },
      sheetless,
      display.sides,
      noSwaps,
    );
    expect(onSheet.options.map((o) => o.id)).toEqual(['p', 'r']);
    expect(chooseSub({ step: 'off', side: 'first' }, 'r', sheetless, noSwaps).kind).toBe('step');
    expect(chooseSub({ step: 'on', side: 'first', off: 'q' }, 'p', sheetless, noSwaps).kind).toBe(
      'record',
    );
  });

  it('read from a bootstrap whose rows carry no slot (an older web): no starters, so both steps list every player', () => {
    const old = {
      ...INDOOR,
      sides: {
        ...INDOOR.sides,
        home: {
          ...INDOOR.sides.home!,
          lineup: INDOOR.sides.home!.lineup.map(({ slot: _slot, ...row }) => row),
        },
      },
    };
    const sheetless = volleyballPeopleOf(old);
    expect(sheetless.first.every((one) => one.slot === null)).toBe(true);
    const offSheet = subSheet({ step: 'off', side: 'first' }, sheetless, display.sides, noSwaps);
    expect(offSheet.options.map((o) => o.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']);
  });

  it('a row with no slot among rows that have one starts, as the engine’s lineup reads it', () => {
    const mixed = {
      ...INDOOR,
      sides: {
        ...INDOOR.sides,
        home: {
          ...INDOOR.sides.home!,
          lineup: INDOOR.sides.home!.lineup.map(({ slot: _slot, ...row }) =>
            row.personId === 'h3' ? row : { ...row, slot: _slot },
          ),
        },
      },
    };
    const offSheet = subSheet(
      { step: 'off', side: 'first' },
      volleyballPeopleOf(mixed),
      display.sides,
      noSwaps,
    );
    expect(offSheet.options.map((o) => o.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  });

  it('a choice off the sheet’s list is refused: a bench player cannot come off, a starter cannot come on', () => {
    const off: SubStep = { step: 'off', side: 'first' };
    expect(chooseSub(off, 'h7', people, noSwaps)).toEqual({ kind: 'step', step: off });
    const on: SubStep = { step: 'on', side: 'first', off: 'h2' };
    expect(chooseSub(on, 'h3', people, noSwaps)).toEqual({ kind: 'step', step: on });
    expect(chooseSub(on, 'h7', people, noSwaps).kind).toBe('record');
  });

  it('a side with no players, or one, is recorded as the side alone at once', () => {
    expect(startSub('first', nobody)).toEqual({
      kind: 'record',
      tap: { kind: 'sub', side: 'first' },
    });
    expect(startSub('first', one)).toEqual({ kind: 'record', tap: { kind: 'sub', side: 'first' } });
    const coachOnly: VolleyballPeople = {
      first: [{ personId: 'c', name: 'C', official: true, slot: null }],
      second: [],
    };
    expect(startSub('first', coachOnly).kind).toBe('record');
  });

  it('a pair (beach players, exactly two) can still pair off: one comes off, the other on', () => {
    const pair: VolleyballPeople = {
      first: [
        { personId: 'p', name: 'P', official: false, slot: null },
        { personId: 'q', name: 'Q', official: false, slot: null },
      ],
      second: [],
    };
    const open = startSub('first', pair);
    expect(open.kind).toBe('step');
    expect(chooseSub({ step: 'on', side: 'first', off: 'p' }, 'q', pair, noSwaps)).toEqual({
      kind: 'record',
      tap: { kind: 'sub', side: 'first', off: 'p', on: 'q' },
    });
  });

  it('a choice the step does not offer, or a second press of one, leaves the step', () => {
    const off: SubStep = { step: 'off', side: 'first' };
    expect(chooseSub(off, 'nobody', people, noSwaps)).toEqual({ kind: 'step', step: off });
    expect(chooseSub(off, 'h-coach', people, noSwaps)).toEqual({ kind: 'step', step: off });
    expect(chooseSub(off, 'a1', people, noSwaps)).toEqual({ kind: 'step', step: off });
    const on: SubStep = { step: 'on', side: 'first', off: 'h2' };
    expect(chooseSub(on, 'h2', people, noSwaps)).toEqual({ kind: 'step', step: on });
    expect(chooseSub(on, 'a1', people, noSwaps)).toEqual({ kind: 'step', step: on });
    // a double press: the move from the same step with the same choice is the same move
    expect(chooseSub(off, 'h2', people, noSwaps)).toEqual(chooseSub(off, 'h2', people, noSwaps));
  });

  it('the away side’s people are its own (the other seat)', () => {
    expect(chooseSub({ step: 'off', side: 'second' }, 'a1', people, noSwaps)).toEqual({
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
