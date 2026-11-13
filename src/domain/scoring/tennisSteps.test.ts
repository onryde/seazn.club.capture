import { tennisPadRules } from '@seazn/engine/pad';
import { describe, expect, it } from 'vitest';
import { display } from '@/domain/scoring/tennisFold.testkit';
import {
  awardSheet,
  backAward,
  backBreak,
  breakSheet,
  chooseAward,
  chooseBreak,
  startAward,
  startBreak,
} from '@/domain/scoring/tennisSteps';
import { DOUBLES, start } from '../../../test/tennisLedger';

// S2-7 Task 7 (rulings 219, 220): the award step (a side, then a confirm) and the break step (a kind, then a side or "Both /
// none"). The tap an award sends is `{winner}` and a break's is `{kind, by?}`: nothing more (rulings 217, 220).

const T = 'scoring.tennis.';
const HOME = 'Ana Ruiz';
const AWAY = 'Bea Lund';
const singles = display([start()]);
const doubles = display([start()], { bootstrap: DOUBLES });

describe('the award step', () => {
  it('asks the side, naming both as typed', () => {
    const sheet = awardSheet(startAward(), singles);
    expect(sheet.title).toEqual({ key: `${T}award.title` });
    expect(sheet.body).toEqual({ key: `${T}award.ask` });
    expect(sheet.options).toEqual([
      { id: 'first', label: HOME, tone: 'standard' },
      { id: 'second', label: AWAY, tone: 'standard' },
    ]);
  });

  it('goes from a side to the confirm step, which says which game to whom, then records', () => {
    const move = chooseAward(startAward(), 'second');
    expect(move).toEqual({ kind: 'step', step: { step: 'confirm', side: 'second' } });
    if (move.kind !== 'step') throw new Error('not a step');
    const sheet = awardSheet(move.step, singles);
    expect(sheet.title).toEqual({ key: `${T}award.confirm.title` });
    expect(sheet.body).toEqual({ key: `${T}award.confirm.body`, vars: { side: AWAY } });
    expect(sheet.options).toEqual([
      { id: 'confirm', label: { key: `${T}award.confirm.action` }, tone: 'standard' },
    ]);
    expect(chooseAward(move.step, 'confirm')).toEqual({
      kind: 'record',
      tap: { kind: 'award', side: 'second' },
    });
  });

  it('names a doubles side with both partners', () => {
    const sheet = awardSheet({ step: 'confirm', side: 'first' }, doubles);
    expect(sheet.body).toEqual({
      key: `${T}award.confirm.body`,
      vars: { side: 'Ruiz / Vega h1 / Ruiz / Vega h2' },
    });
  });

  it('refuses a choice the step does not offer, and moves once on a double press', () => {
    const side = startAward();
    for (const choice of ['confirm', 'third', ''])
      expect(chooseAward(side, choice)).toEqual({ kind: 'step', step: side });
    const confirm = { step: 'confirm', side: 'first' } as const;
    for (const choice of ['first', 'second', ''])
      expect(chooseAward(confirm, choice)).toEqual({ kind: 'step', step: confirm });
    const once = chooseAward(side, 'first');
    if (once.kind !== 'step') throw new Error('not a step');
    expect(chooseAward(once.step, 'first')).toEqual(once);
  });

  it('goes back from the confirm step to the side step and closes from the side step', () => {
    expect(backAward({ step: 'confirm', side: 'second' })).toEqual({ step: 'side' });
    expect(backAward(startAward())).toBeNull();
  });
});

describe('the break step', () => {
  it('lists medical, toilet, heat, other, in the engine’s order', () => {
    const sheet = breakSheet(startBreak(), singles);
    expect(sheet.title).toEqual({ key: `${T}break.title` });
    expect(sheet.body).toEqual({ key: `${T}break.askKind` });
    expect(sheet.options.map((option) => option.id)).toEqual([
      'medical',
      'toilet',
      'heat',
      'other',
    ]);
    expect(sheet.options.map((option) => option.label)).toEqual([
      { key: `${T}break.kind.medical` },
      { key: `${T}break.kind.toilet` },
      { key: `${T}break.kind.heat` },
      { key: `${T}break.kind.other` },
    ]);
  });

  it('is the engine’s list as a set: a kind the engine adds fails here', () => {
    const ids = breakSheet(startBreak(), singles).options.map((option) => option.id);
    expect(new Set(ids)).toEqual(new Set(tennisPadRules.interruptionKinds));
  });

  it('asks the side after the kind: each side as typed, then "Both / none"', () => {
    const move = chooseBreak(startBreak(), 'heat');
    expect(move).toEqual({ kind: 'step', step: { step: 'side', breakKind: 'heat' } });
    if (move.kind !== 'step') throw new Error('not a step');
    const sheet = breakSheet(move.step, singles);
    expect(sheet.title).toEqual({ key: `${T}break.kind.heat` });
    expect(sheet.body).toEqual({ key: `${T}break.askSide` });
    expect(sheet.options).toEqual([
      { id: 'first', label: HOME, tone: 'standard' },
      { id: 'second', label: AWAY, tone: 'standard' },
      { id: 'both', label: { key: `${T}break.both` }, tone: 'standard' },
    ]);
  });

  it('records a side’s break with the side, and "Both / none" with none', () => {
    const step = { step: 'side', breakKind: 'medical' } as const;
    expect(chooseBreak(step, 'second')).toEqual({
      kind: 'record',
      tap: { kind: 'break', breakKind: 'medical', side: 'second' },
    });
    expect(chooseBreak(step, 'both')).toEqual({
      kind: 'record',
      tap: { kind: 'break', breakKind: 'medical', side: null },
    });
  });

  it('refuses a choice the step does not offer, and moves once on a double press', () => {
    const kind = startBreak();
    for (const choice of ['first', 'both', 'rain', ''])
      expect(chooseBreak(kind, choice)).toEqual({ kind: 'step', step: kind });
    const side = { step: 'side', breakKind: 'toilet' } as const;
    for (const choice of ['medical', 'toilet', 'third', ''])
      expect(chooseBreak(side, choice)).toEqual({ kind: 'step', step: side });
    const once = chooseBreak(kind, 'toilet');
    if (once.kind !== 'step') throw new Error('not a step');
    expect(chooseBreak(once.step, 'toilet')).toEqual({ kind: 'step', step: once.step });
  });

  it('goes back from the side step to the kind step and closes from the kind step', () => {
    expect(backBreak({ step: 'side', breakKind: 'heat' })).toEqual({ step: 'kind' });
    expect(backBreak(startBreak())).toBeNull();
  });
});
