import { describe, expect, it } from 'vitest';
import {
  chooseSanction,
  sanctionNote,
  sanctionSheet,
  startSanction,
  type SanctionStep,
} from '@/domain/scoring/volleyballSanction';
import { volleyballEventFor } from '@/domain/scoring/volleyballEvents';
import { volleyballPeopleOf, type VolleyballPeople } from '@/domain/scoring/volleyballPeople';
import { BEACH, INDOOR } from '../../../test/volleyballLedger';
import { displayOf } from './volleyballPad.testkit';

// S2-6 Task 7: the Sanction steps (rulings 174, 185, 187, 189), over the real seeds.

const people = volleyballPeopleOf(INDOOR);
const display = displayOf([]);
const level = startSanction('first');

describe('volleyballSanction: level, then person', () => {
  it('starts at the level, whose choices are the engine’s four, lightest first', () => {
    expect(level).toEqual({ step: 'level', side: 'first' });
    const sheet = sanctionSheet(level, people, display.sides);
    expect(sheet.title).toEqual({ key: 'scoring.sanction.title' });
    expect(sheet.body).toBe('Falcons');
    expect(sheet.options.map((o) => [o.id, o.tone])).toEqual([
      ['warning', 'standard'],
      ['penalty', 'standard'],
      ['expulsion', 'destructive'],
      ['disqualification', 'destructive'],
    ]);
    expect(sheet.options[2]?.label).toEqual({ key: 'scoring.sanction.expulsion' });
  });

  it('lists the players and then the coach for the person, the level as the body', () => {
    const step: SanctionStep = { step: 'person', side: 'first', level: 'penalty' };
    const sheet = sanctionSheet(step, people, display.sides);
    expect(sheet.title).toEqual({ key: 'scoring.sanction.who' });
    expect(sheet.body).toEqual({ key: 'scoring.sanction.penalty' });
    expect(sheet.options.map((o) => o.id)).toEqual([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'h7',
      'h-coach',
    ]);
    expect(sheet.options.at(-1)?.label).toBe('Falcons h-coach');
  });

  it('lists officials alone for a side with only officials', () => {
    const only: VolleyballPeople = {
      first: [
        { personId: 'c1', name: 'C1', official: true, slot: null },
        { personId: 's1', name: 'S1', official: true, slot: null },
      ],
      second: [],
    };
    const move = chooseSanction(level, 'warning', only);
    expect(move).toEqual({
      kind: 'step',
      step: { step: 'person', side: 'first', level: 'warning' },
    });
    expect(
      sanctionSheet(
        { step: 'person', side: 'first', level: 'warning' },
        only,
        display.sides,
      ).options.map((o) => o.id),
    ).toEqual(['c1', 's1']);
  });

  it('goes level -> person -> record, naming the person by id', () => {
    const asked = chooseSanction(level, 'expulsion', people);
    expect(asked).toEqual({
      kind: 'step',
      step: { step: 'person', side: 'first', level: 'expulsion' },
    });
    expect(chooseSanction((asked as { step: SanctionStep }).step, 'h-coach', people)).toEqual({
      kind: 'record',
      tap: { kind: 'sanction', side: 'first', level: 'expulsion', person: 'h-coach' },
    });
  });

  it('one person on the sheet is the sanction’s at once; none records the side alone (ruling 187)', () => {
    const lone: VolleyballPeople = {
      first: [{ personId: 'x', name: 'X', official: false, slot: null }],
      second: [],
    };
    expect(chooseSanction(level, 'warning', lone)).toEqual({
      kind: 'record',
      tap: { kind: 'sanction', side: 'first', level: 'warning', person: 'x' },
    });
    expect(chooseSanction(level, 'warning', { first: [], second: [] })).toEqual({
      kind: 'record',
      tap: { kind: 'sanction', side: 'first', level: 'warning', person: null },
    });
  });

  it('refuses a choice the step does not offer, and the other side’s person', () => {
    expect(chooseSanction(level, 'red', people)).toEqual({ kind: 'step', step: level });
    const person: SanctionStep = { step: 'person', side: 'first', level: 'warning' };
    expect(chooseSanction(person, 'a1', people)).toEqual({ kind: 'step', step: person });
    expect(chooseSanction(person, 'warning', people)).toEqual({ kind: 'step', step: person });
  });

  it('every move it records is a tap the events file turns into the engine’s event', () => {
    const move = chooseSanction({ step: 'person', side: 'second', level: 'penalty' }, 'a3', people);
    expect(move.kind).toBe('record');
    if (move.kind !== 'record') return;
    const event = volleyballEventFor(move.tap, { bootstrap: INDOOR, display });
    expect(event?.type).toBe('volleyball.sanction');
    expect(event?.payload).toEqual({ by: 'ent-away', level: 'penalty', person: 'a3' });
  });
});

describe('volleyballSanction: the line after the sanction', () => {
  const sides = display.sides;

  it('a penalty names the other side: its rally is the scorer’s to tap (ruling 185)', () => {
    expect(sanctionNote('penalty', 'first', sides, false)).toEqual({
      key: 'scoring.volleyball.done.penalty',
      vars: { side: 'Herons' },
    });
    expect(sanctionNote('penalty', 'second', sides, false)).toEqual({
      key: 'scoring.volleyball.done.penalty',
      vars: { side: 'Falcons' },
    });
  });

  it('an expulsion or a disqualification names the team: six indoor, two on the beach (174, 189)', () => {
    for (const lvl of ['expulsion', 'disqualification'] as const) {
      expect(sanctionNote(lvl, 'first', sides, false)).toEqual({
        key: 'scoring.volleyball.done.fieldSix',
        vars: { level: { key: `scoring.sanction.${lvl}` }, team: 'Falcons' },
      });
      expect(sanctionNote(lvl, 'second', sides, true)).toEqual({
        key: 'scoring.volleyball.done.fieldTwo',
        vars: { level: { key: `scoring.sanction.${lvl}` }, team: 'Herons' },
      });
    }
  });

  it('a warning says nothing', () => {
    expect(sanctionNote('warning', 'first', sides, false)).toBeNull();
  });

  it('beach: a pair’s players are offered, no coach, and the beach display says beach', () => {
    const beach = volleyballPeopleOf(BEACH);
    expect(beach.first.map((p) => p.personId)).toEqual(['h1', 'h2']);
    expect(displayOf([], { bootstrap: BEACH }).beach).toBe(true);
  });
});
