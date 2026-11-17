import { describe, expect, it } from 'vitest';
import { roundLine, stageLine, STAGE_LABEL_MAX } from '@/domain/session/stageLine';

// The contract's own bound (capture-descriptor.v1 stage.label: 1..40), in code points.
const CASES: readonly (readonly [
  why: string,
  input: string | null | undefined,
  shown: string | null,
])[] = [
  ['a short code', 'QF', 'QF'],
  [
    'a division, a pool and a round, verbatim',
    'Open · Grupo A · Ronda 2',
    'Open · Grupo A · Ronda 2',
  ],
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

// Court stream (spec 2026-11-14 §6.2): on a court code the round line leads with the court's name.
describe('the round line on a court code (roundLine)', () => {
  it.each<
    [why: string, court: string | null, stage: string | null | undefined, shown: string | null]
  >([
    ['a court with no stage is the court alone', 'Court 2', null, 'Court 2'],
    ['a court and a stage join with a middle dot', 'Court 2', 'Semi-final', 'Court 2 · Semi-final'],
    ['a fixture code with a stage is the stage, unchanged', null, 'Final', 'Final'],
    ['no court and no stage is no line', null, null, null],
    [
      'a stage past the 40-character bound is dropped, the court stays',
      'Court 2',
      'x'.repeat(41),
      'Court 2',
    ],
    ['an empty stage is dropped', 'Court 2', '', 'Court 2'],
    ['an absent stage is dropped', 'Court 2', undefined, 'Court 2'],
  ])('%s', (_why, court, stage, shown) => {
    expect(roundLine(court, stage)).toBe(shown);
  });
});
