import { describe, expect, it } from 'vitest';
import { splitMatchLabel } from '@/domain/session/matchLabel';
import { CASES } from '../../../test/fixtures/matchLabelCases';

/** Spec §2's "Tests owe" list, by the table's names: C2 keeps every one of them. */
const SPEC_OWES = [
  'short singles',
  'long singles',
  'doubles',
  'long doubles',
  'Match {n}',
  'two " v "',
  'the 200-char maximum',
];

describe('splitMatchLabel (C2, D2 §4.4)', () => {
  it.each(CASES)('%s', (_name, label, shape) => {
    expect(splitMatchLabel(label)).toEqual(shape);
  });

  it('has thirteen cases, both shapes among them (anti-vacuity)', () => {
    expect(CASES).toHaveLength(13);
    expect(CASES.filter(([, , shape]) => shape.kind === 'block')).toHaveLength(3);
    expect(CASES.map(([name]) => name)).toEqual(expect.arrayContaining(SPEC_OWES));
    // The fixture itself keeps §2's maximum exactly.
    expect(CASES.find(([name]) => name === 'the 200-char maximum')?.[1]).toHaveLength(200);
  });

  // The table has an empty side A only: these are the empty side B and both, each one block of the label as typed.
  it('a side missing on either end is one block, never an empty side', () => {
    expect(splitMatchLabel(' v Bea')).toEqual({ kind: 'block', text: 'v Bea' });
    expect(splitMatchLabel('Ana v ')).toEqual({ kind: 'block', text: 'Ana v' });
    expect(splitMatchLabel(' v ')).toEqual({ kind: 'block', text: 'v' });
  });

  it('a side of nothing but partner marks is an empty side: one block', () => {
    expect(splitMatchLabel('Ana v  / ')).toEqual({ kind: 'block', text: 'Ana v  /' });
  });

  it('a lone " / " is not a partner list', () => {
    expect(splitMatchLabel('Ana / v Bea')).toEqual({ kind: 'sides', a: 'Ana /', b: 'Bea' });
  });

  it('partners in a block are the block as typed: only a side joins its partners', () => {
    expect(splitMatchLabel('Ana / Bea')).toEqual({ kind: 'block', text: 'Ana / Bea' });
  });

  // The names are trimmed, so a doubled space around " v " or " / " never shows as a leading or trailing blank.
  it('trims each name: spaces around " v " and " / " are not shown', () => {
    expect(splitMatchLabel('Ana  v  Bea')).toEqual({ kind: 'sides', a: 'Ana', b: 'Bea' });
    expect(splitMatchLabel('Ana  /  Bea v Cai')).toEqual({
      kind: 'sides',
      a: 'Ana / Bea',
      b: 'Cai',
    });
  });
});
