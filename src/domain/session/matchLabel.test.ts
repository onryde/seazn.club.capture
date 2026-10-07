import { describe, expect, it } from 'vitest';
import { labelSize, splitMatchLabel } from '@/domain/session/matchLabel';
import { CASES } from '../../../test/fixtures/matchLabelCases';

/** Spec §2's display rule. The seven owed cases live in the shared table; the edges are here. */
describe('splitMatchLabel (spec §2)', () => {
  it.each(CASES)('%s', (_name, label, shape, size) => {
    const split = splitMatchLabel(label);
    expect(split).toEqual(shape);
    expect(labelSize(split)).toBe(size);
  });

  it('covers every case §2 owes', () => {
    expect(CASES).toHaveLength(7);
    // The fixture itself keeps §2's maximum exactly.
    expect(CASES.find(([name]) => name === 'the 200-char maximum')?.[1]).toHaveLength(200);
  });

  it('a side missing on either end is one block, not an empty side', () => {
    const labels = [' v Bea', 'Ana v ', ' v '];
    for (const label of labels) expect(splitMatchLabel(label).kind).toBe('block');
    expect(labels).toHaveLength(3);
  });

  it('an empty label is one empty block at the regular size (the empty case)', () => {
    // No " v " in it, so §2's rule makes it one block. The screen never shows it:
    // selectLabel reads an empty label as none, and the component renders nothing.
    const split = splitMatchLabel('');
    expect(split).toEqual({ kind: 'block', block: { lines: [''], wrap: 2 } });
    expect(labelSize(split)).toBe('regular');
  });

  it('an empty partner piece is dropped, not shown as a blank line (§2: one partner per line)', () => {
    // The one input that reaches the filter: the side is not trimmed away to 'Ana /', so the split yields ''.
    expect(splitMatchLabel('Ana /  / Bea v Cai')).toEqual({
      kind: 'sides',
      a: { lines: ['Ana', 'Bea'], wrap: 1 },
      b: { lines: ['Cai'], wrap: 2 },
    });
  });

  it('a lone " / " is not a partner list', () => {
    expect(splitMatchLabel('Ana / v Bea')).toEqual({
      kind: 'sides',
      a: { lines: ['Ana /'], wrap: 2 },
      b: { lines: ['Bea'], wrap: 2 },
    });
  });

  it("the size turns at §2's 26 characters, not before", () => {
    expect(labelSize(splitMatchLabel(`${'A'.repeat(26)} v B`))).toBe('regular');
    expect(labelSize(splitMatchLabel(`${'A'.repeat(27)} v B`))).toBe('long');
  });
});
