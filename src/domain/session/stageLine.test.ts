import { describe, expect, it } from 'vitest';
import { stageLine, STAGE_LABEL_MAX } from '@/domain/session/stageLine';

// The contract's own bound (capture-descriptor.v1 stage.label: 1..40), in code points.
const CASES: readonly (readonly [
  why: string,
  input: string | null | undefined,
  shown: string | null,
])[] = [
  ['a short code', 'QF', 'QF'],
  ['a pool and a round, verbatim', 'Grupo A · R2', 'Grupo A · R2'],
  ['exactly 40 characters', 'x'.repeat(40), 'x'.repeat(40)],
  [
    '40 code points where the last is an emoji (two UTF-16 units)',
    `${'x'.repeat(39)}🏏`,
    `${'x'.repeat(39)}🏏`,
  ],
  ['41 characters shows no line, never a cut one', 'x'.repeat(41), null],
  ['empty', '', null],
  ['null', null, null],
  ['absent', undefined, null],
];

describe('the round line (spec §2: a missing, empty or over-40 label shows no line)', () => {
  it.each(CASES)('%s', (_why, input, shown) => {
    expect(stageLine(input)).toBe(shown);
  });

  it('swept 8 cases, and the bound is the contract’s 40', () => {
    expect(CASES).toHaveLength(8);
    expect(STAGE_LABEL_MAX).toBe(40);
  });
});
