import { describe, expect, it } from 'vitest';
import { labelSize, splitMatchLabel } from '@/domain/session/matchLabel';
import { CASES } from '../../../test/fixtures/matchLabelCases';

/** §2's "Tests owe" list, by the table's names. */
const SPEC_OWES = [
  'short singles',
  'long singles',
  'doubles',
  'long doubles',
  'Match {n}',
  'two " v "',
  'the 200-char maximum',
];

/** Spec §2's display rule. The owed cases live in the shared table; the edges are here. */
describe('splitMatchLabel (spec §2)', () => {
  it.each(CASES)('%s', (_name, label, shape, size) => {
    const split = splitMatchLabel(label);
    expect(split).toEqual(shape);
    expect(labelSize(split)).toBe(size);
  });

  it('covers every case §2 owes, and the five the review owes', () => {
    expect(CASES).toHaveLength(12);
    expect(CASES.map(([name]) => name)).toEqual(expect.arrayContaining(SPEC_OWES));
    expect(SPEC_OWES).toHaveLength(7);
    // The fixture itself keeps §2's maximum exactly.
    expect(CASES.find(([name]) => name === 'the 200-char maximum')?.[1]).toHaveLength(200);
  });

  it('the emoji rows sit where they say: 26 code points, more UTF-16 units', () => {
    const sideOf = (name: string, at: 0 | 1) => {
      const label = CASES.find(([n]) => n === name)?.[1] ?? '';
      return label.split(' v ')[at] ?? '';
    };
    const sides = [
      sideOf('an emoji is one character, at the turn', 0),
      sideOf('a team name with emoji', 1),
    ];
    expect(sides.map((side) => [...side].length)).toEqual([26, 26]);
    expect(sides.map((side) => side.length)).toEqual([27, 28]);
  });

  it('no side is ever more than two lines tall, whatever its partner count (review M1)', () => {
    // A side's height is its lines times each line's wrap. The table, then 1 to 6 partners a side.
    const NAMES = ['Ana', 'Bea', 'Cai', 'Dee', 'Eva', 'Fay'];
    const team = (n: number) => NAMES.slice(0, n).join(' / ');
    const labels: string[] = CASES.map(([, label]) => label);
    for (let a = 1; a <= NAMES.length; a += 1)
      for (let b = 1; b <= NAMES.length; b += 1) labels.push(`${team(a)} v ${team(b)}`);
    let checked = 0;
    let tallest = 0;
    for (const label of labels) {
      const split = splitMatchLabel(label);
      for (const part of split.kind === 'block' ? [split.block] : [split.a, split.b]) {
        tallest = Math.max(tallest, part.lines.length * part.wrap);
        checked += 1;
      }
    }
    expect(tallest).toBe(2);
    // 11 two-sided rows and one block in the table (23 parts), then 36 labels of two sides.
    expect(checked).toBe(95);
  });

  it('partners in a block are not doubles: the Q4 rule is a side’s', () => {
    // No " v ", so §2 makes it one block, sized by its longest line (9 characters).
    const split = splitMatchLabel('Ana / Bea');
    expect(split).toEqual({ kind: 'block', block: { lines: ['Ana / Bea'], wrap: 2 } });
    expect(labelSize(split)).toBe('regular');
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
