import { describe, expect, it } from 'vitest';
import type { BadmintonSide } from '@/domain/scoring/badmintonPad';
import type { PadSide } from '@/domain/scoring/padView';
import {
  chooseSanction,
  sanctionSheet,
  startSanction,
  type SanctionStep,
} from '@/domain/scoring/badmintonSanction';

const sides: Readonly<Record<PadSide, BadmintonSide>> = {
  first: { players: ['A. Sharma', 'R. Iyer'] },
  second: { players: ['L. Chen'] },
};

const choose = (step: SanctionStep, choice: string) => chooseSanction(step, choice, sides);

describe('the sanction flow: level, then person, then for a disqualification a confirm', () => {
  it('starts at the level, for the side whose Sanction was tapped', () => {
    expect(startSanction('second')).toEqual({ step: 'level', side: 'second' });
  });

  it('records a warning after the person is chosen', () => {
    const person = choose(startSanction('first'), 'warning');
    expect(person).toEqual({
      kind: 'step',
      step: { step: 'person', side: 'first', level: 'warning' },
    });
    if (person.kind !== 'step') throw new Error('expected a step');
    expect(choose(person.step, '1')).toEqual({
      kind: 'record',
      sanction: { side: 'first', level: 'warning', person: 'R. Iyer' },
    });
  });

  it('asks a disqualification to be confirmed, since it ends the match', () => {
    const person = choose(startSanction('second'), 'disqualification');
    if (person.kind !== 'step') throw new Error('expected a step');
    const confirm = choose(person.step, '0');
    expect(confirm).toEqual({
      kind: 'step',
      step: { step: 'confirm', side: 'second', person: 'L. Chen' },
    });
    if (confirm.kind !== 'step') throw new Error('expected a step');
    expect(choose(confirm.step, 'confirm')).toEqual({
      kind: 'record',
      sanction: { side: 'second', level: 'disqualification', person: 'L. Chen' },
    });
  });

  it.each([
    [{ step: 'level', side: 'first' }, ['', 'Warning', 'yellow', '0']],
    [{ step: 'person', side: 'second', level: 'penalty' }, ['', '1', '-1', '0.0', 'L. Chen', 'x']],
    [{ step: 'confirm', side: 'second', person: 'L. Chen' }, ['', 'Confirm', 'cancel', '0']],
  ] as const)('stays on %j for a choice it does not offer', (step, choices) => {
    for (const choice of choices) {
      expect(choose(step, choice), choice).toEqual({ kind: 'step', step });
    }
  });
});

describe('sanctionSheet: what each step asks', () => {
  it('asks the level, naming the side, with the four levels lightest first', () => {
    expect(sanctionSheet(startSanction('first'), sides)).toEqual({
      title: { key: 'scoring.sanction.title' },
      body: 'A. Sharma / R. Iyer',
      options: [
        { id: 'warning', label: { key: 'scoring.sanction.warning' }, tone: 'standard' },
        { id: 'penalty', label: { key: 'scoring.sanction.penalty' }, tone: 'standard' },
        { id: 'expulsion', label: { key: 'scoring.sanction.expulsion' }, tone: 'standard' },
        {
          id: 'disqualification',
          label: { key: 'scoring.sanction.disqualification' },
          tone: 'destructive',
        },
      ],
    });
  });

  it('asks who, from that side’s players only', () => {
    expect(sanctionSheet({ step: 'person', side: 'first', level: 'expulsion' }, sides)).toEqual({
      title: { key: 'scoring.sanction.who' },
      body: { key: 'scoring.sanction.expulsion' },
      options: [
        { id: '0', label: 'A. Sharma', tone: 'standard' },
        { id: '1', label: 'R. Iyer', tone: 'standard' },
      ],
    });
  });

  it('offers a singles side’s one player', () => {
    expect(
      sanctionSheet({ step: 'person', side: 'second', level: 'warning' }, sides).options,
    ).toEqual([{ id: '0', label: 'L. Chen', tone: 'standard' }]);
  });

  it('says a disqualification ends the match before it is recorded', () => {
    expect(sanctionSheet({ step: 'confirm', side: 'second', person: 'L. Chen' }, sides)).toEqual({
      title: { key: 'scoring.sanction.confirm.title', vars: { person: 'L. Chen' } },
      body: { key: 'scoring.sanction.confirm.body' },
      options: [
        {
          id: 'confirm',
          label: { key: 'scoring.sanction.confirm.action' },
          tone: 'destructive',
        },
      ],
    });
  });
});
