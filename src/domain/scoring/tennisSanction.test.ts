import { tennisPadRules } from '@seazn/engine/pad';
import { describe, expect, it } from 'vitest';
import { display, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import {
  backViolation,
  chooseViolation,
  startViolation,
  tennisPeopleOf,
  violationDone,
  violationSheet,
  type ViolationStep,
} from '@/domain/scoring/tennisSanction';
import { DOUBLES, SINGLES, point, start } from '../../../test/tennisLedger';

// S2-7 Task 7 (ruling 218): a code violation, step by step: the level, the player when the side has two, a confirm, and the
// line that says what to tap next. The phone sends the violation and nothing else: the sanction moves no score (TN-SS-2), so
// the scorer taps a penalty's point or game. The levels are the engine's own list without `default`, which is the organiser's.

const T = 'scoring.tennis.';
const HOME = 'Ana Ruiz';
const AWAY = 'Bea Lund';
const singles = display([start()]);
const doubles = display([start()], { bootstrap: DOUBLES });
const doublesPeople = tennisPeopleOf(DOUBLES);
const singlesPeople = tennisPeopleOf(SINGLES);

/** The sheet's choices, by id. */
const ids = (step: ViolationStep, shown = singles, people = singlesPeople) =>
  violationSheet(step, shown, people).options.map((option) => option.id);

describe('the level step', () => {
  it('lists warning, point penalty and game penalty, in that order: never a default', () => {
    expect(ids(startViolation('first'))).toEqual(['warning', 'point_penalty', 'game_penalty']);
  });

  it('is the engine’s list without default, as a set: a level the engine adds fails here', () => {
    const engine = tennisPadRules.sanctionLevels.filter((level) => level !== 'default');
    expect(new Set(ids(startViolation('first')))).toEqual(new Set(engine));
    expect(tennisPadRules.sanctionLevels).toContain('default');
  });

  it('names the level in words and the side as typed, and draws only the game penalty as a caution', () => {
    const sheet = violationSheet(startViolation('second'), singles, singlesPeople);
    expect(sheet.title).toEqual({ key: `${T}violation.title` });
    expect(sheet.body).toBe(AWAY);
    expect(sheet.options.map((option) => [option.label, option.tone])).toEqual([
      [{ key: `${T}level.warning` }, 'standard'],
      [{ key: `${T}level.pointPenalty` }, 'standard'],
      [{ key: `${T}level.gamePenalty` }, 'destructive'],
    ]);
  });

  it('refuses a default, and anything it does not list, and stays on the step', () => {
    const step = startViolation('first');
    for (const choice of ['default', 'penalty', '', 'confirm'])
      expect(chooseViolation(step, choice, singles, singlesPeople)).toEqual({ kind: 'step', step });
  });
});

describe('singles', () => {
  it('skips the person step: a level goes to the confirm step with no person', () => {
    expect(chooseViolation(startViolation('first'), 'warning', singles, singlesPeople)).toEqual({
      kind: 'step',
      step: { step: 'confirm', side: 'first', level: 'warning', person: null },
    });
  });

  it('records the violation on the confirm step, with the side and the level', () => {
    const step: ViolationStep = {
      step: 'confirm',
      side: 'second',
      level: 'point_penalty',
      person: null,
    };
    expect(chooseViolation(step, 'confirm', singles, singlesPeople)).toEqual({
      kind: 'record',
      tap: { kind: 'violation', side: 'second', level: 'point_penalty', person: null },
    });
  });

  it('says what is being recorded on the confirm step: the level and the side, never a different question', () => {
    const step: ViolationStep = {
      step: 'confirm',
      side: 'first',
      level: 'game_penalty',
      person: null,
    };
    const sheet = violationSheet(step, singles, singlesPeople);
    expect(sheet.title).toEqual({ key: `${T}violation.confirm.title` });
    expect(sheet.body).toEqual({
      key: `${T}violation.confirm.body`,
      vars: { level: { key: `${T}level.gamePenalty` }, who: HOME },
    });
    expect(sheet.options).toEqual([
      { id: 'confirm', label: { key: `${T}violation.confirm.action` }, tone: 'standard' },
    ]);
  });
});

describe('doubles', () => {
  it('asks the player after the level, listing both partners by person id', () => {
    const move = chooseViolation(startViolation('first'), 'warning', doubles, doublesPeople);
    expect(move).toEqual({
      kind: 'step',
      step: { step: 'person', side: 'first', level: 'warning' },
    });
    if (move.kind !== 'step') throw new Error('not a step');
    const sheet = violationSheet(move.step, doubles, doublesPeople);
    expect(sheet.title).toEqual({ key: `${T}violation.who` });
    expect(sheet.body).toEqual({ key: `${T}level.warning` });
    expect(sheet.options).toEqual([
      { id: 'h1', label: 'Ruiz / Vega h1', tone: 'standard' },
      { id: 'h2', label: 'Ruiz / Vega h2', tone: 'standard' },
    ]);
  });

  it('lists the other side’s partners for the other side', () => {
    const step: ViolationStep = { step: 'person', side: 'second', level: 'warning' };
    expect(ids(step, doubles, doublesPeople)).toEqual(['a1', 'a2']);
  });

  it('goes from the person to the confirm step with that person, and records them', () => {
    const person: ViolationStep = { step: 'person', side: 'first', level: 'point_penalty' };
    const move = chooseViolation(person, 'h2', doubles, doublesPeople);
    expect(move).toEqual({
      kind: 'step',
      step: { step: 'confirm', side: 'first', level: 'point_penalty', person: 'h2' },
    });
    if (move.kind !== 'step') throw new Error('not a step');
    expect(violationSheet(move.step, doubles, doublesPeople).body).toEqual({
      key: `${T}violation.confirm.body`,
      vars: { level: { key: `${T}level.pointPenalty` }, who: 'Ruiz / Vega h2' },
    });
    expect(chooseViolation(move.step, 'confirm', doubles, doublesPeople)).toEqual({
      kind: 'record',
      tap: { kind: 'violation', side: 'first', level: 'point_penalty', person: 'h2' },
    });
  });

  it('refuses a person who is not on the side, a stale level and a confirm on the person step', () => {
    const step: ViolationStep = { step: 'person', side: 'first', level: 'warning' };
    for (const choice of ['a1', 'warning', 'confirm', ''])
      expect(chooseViolation(step, choice, doubles, doublesPeople)).toEqual({ kind: 'step', step });
  });

  it('records against the side alone when the sheet lists nobody for it, rather than asking an empty question', () => {
    const none = { first: [], second: [] };
    expect(chooseViolation(startViolation('first'), 'warning', doubles, none)).toEqual({
      kind: 'step',
      step: { step: 'confirm', side: 'first', level: 'warning', person: null },
    });
  });

  it('moves once on a double press: the second press of a level finds a person step that does not offer it', () => {
    const first = chooseViolation(startViolation('first'), 'warning', doubles, doublesPeople);
    if (first.kind !== 'step') throw new Error('not a step');
    expect(chooseViolation(first.step, 'warning', doubles, doublesPeople)).toEqual(first);
  });
});

describe('the confirm step', () => {
  it('refuses anything but its own choice', () => {
    const step: ViolationStep = { step: 'confirm', side: 'first', level: 'warning', person: null };
    for (const choice of ['warning', 'h1', 'first', ''])
      expect(chooseViolation(step, choice, singles, singlesPeople)).toEqual({ kind: 'step', step });
  });

  it('records once: the move holds the tap, and a second press of the same step gives the same tap', () => {
    const step: ViolationStep = { step: 'confirm', side: 'first', level: 'warning', person: null };
    const move = chooseViolation(step, 'confirm', singles, singlesPeople);
    expect(chooseViolation(step, 'confirm', singles, singlesPeople)).toEqual(move);
  });
});

describe('Back', () => {
  it('goes from the confirm step to the person step in doubles and the level step in singles, and closes from the level step', () => {
    const confirm: ViolationStep = {
      step: 'confirm',
      side: 'first',
      level: 'warning',
      person: 'h1',
    };
    expect(backViolation(confirm, doubles, doublesPeople)).toEqual({
      step: 'person',
      side: 'first',
      level: 'warning',
    });
    expect(backViolation({ ...confirm, person: null }, singles, singlesPeople)).toEqual({
      step: 'level',
      side: 'first',
    });
    expect(backViolation(startViolation('first'), singles, singlesPeople)).toBeNull();
  });

  it('goes from the person step to the level step, and from a doubles confirm with nobody listed to the level step', () => {
    expect(
      backViolation(
        { step: 'person', side: 'second', level: 'game_penalty' },
        doubles,
        doublesPeople,
      ),
    ).toEqual({ step: 'level', side: 'second' });
    const none = { first: [], second: [] };
    expect(
      backViolation(
        { step: 'confirm', side: 'first', level: 'warning', person: null },
        doubles,
        none,
      ),
    ).toEqual({ step: 'level', side: 'first' });
  });
});

describe('the line after it is recorded', () => {
  it('a point penalty says to tap the point to the other side', () => {
    expect(violationDone('point_penalty', 'first', singles)).toEqual({
      key: `${T}violation.done.point`,
      vars: { other: AWAY },
    });
    expect(violationDone('point_penalty', 'second', singles)).toEqual({
      key: `${T}violation.done.point`,
      vars: { other: HOME },
    });
  });

  it('a game penalty says to tap Award game for the other side', () => {
    expect(violationDone('game_penalty', 'first', singles)).toEqual({
      key: `${T}violation.done.game`,
      vars: { other: AWAY },
    });
  });

  it('a game penalty in a tie-break says to ask the organiser: Award game is disabled there', () => {
    const breaker = display([start(), ...gamesOf('HAHAHAHAHAHA')]);
    expect(violationDone('game_penalty', 'first', breaker)).toEqual({
      key: `${T}violation.done.breaker`,
    });
    // A point penalty is the same in a tie-break: the point is tapped.
    expect(violationDone('point_penalty', 'first', breaker)).toMatchObject({
      key: `${T}violation.done.point`,
    });
  });

  it('a warning moves nothing and says nothing', () => {
    expect(violationDone('warning', 'first', singles)).toBeNull();
  });

  it('names a doubles side with both partners, as the half does', () => {
    expect(violationDone('point_penalty', 'second', doubles)).toEqual({
      key: `${T}violation.done.point`,
      vars: { other: 'Ruiz / Vega h1 / Ruiz / Vega h2' },
    });
  });

  it('reads the same after a point: it depends on the breaker, not the call', () => {
    const later = display([start(), point('H')]);
    expect(violationDone('game_penalty', 'first', later)).toMatchObject({
      key: `${T}violation.done.game`,
    });
  });
});

describe('the people a side lists', () => {
  it('are the bootstrap’s members by person id, in the side’s order', () => {
    expect(doublesPeople.first.map((one) => one.personId)).toEqual(['h1', 'h2']);
    expect(doublesPeople.second.map((one) => one.name)).toEqual([
      'Lund / Berg a1',
      'Lund / Berg a2',
    ]);
    expect(singlesPeople.first).toEqual([{ personId: 'h1', name: HOME }]);
  });

  it('are nobody while either seat is empty', () => {
    const empty = { ...DOUBLES, sides: { ...DOUBLES.sides, away: null } };
    expect(tennisPeopleOf(empty)).toEqual({ first: [], second: [] });
  });
});
