/**
 * Spec §2's owed cases, each with what §2's display rule says it shows. Every
 * expectation is written out by hand from §2's rule text, or from the owner's
 * Q4 answer, never read from the module under test. Shared by the domain test
 * and the component's test, which shows the same seven.
 */
export const CASES = [
  [
    'short singles',
    'Ana Ruiz v Bea Lima',
    { kind: 'sides', a: { lines: ['Ana Ruiz'], wrap: 2 }, b: { lines: ['Bea Lima'], wrap: 2 } },
    'regular',
  ],
  [
    'long singles',
    'Alexandra Konstantinopoulou v Maria Fernanda Albuquerque',
    {
      kind: 'sides',
      a: { lines: ['Alexandra Konstantinopoulou'], wrap: 2 },
      b: { lines: ['Maria Fernanda Albuquerque'], wrap: 2 },
    },
    'long',
  ],
  [
    'doubles',
    'Ana Ruiz / Bea Lima v Cai Wen / Dee Roy',
    // Q4 option A (owner, 2026-10-07): doubles are long. Every line here is 8 characters or fewer, so only that rule makes it long.
    {
      kind: 'sides',
      a: { lines: ['Ana Ruiz', 'Bea Lima'], wrap: 1 },
      b: { lines: ['Cai Wen', 'Dee Roy'], wrap: 1 },
    },
    'long',
  ],
  [
    'long doubles',
    'Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos',
    {
      kind: 'sides',
      a: { lines: ['Alexandra Konstantinopoulou', 'Bea Lima'], wrap: 1 },
      b: { lines: ['Cai Wen', 'Maria Fernanda Albuquerque Santos'], wrap: 1 },
    },
    'long',
  ],
  ['Match {n}', 'Match 4', { kind: 'block', block: { lines: ['Match 4'], wrap: 2 } }, 'regular'],
  [
    'two " v "',
    'Ana v Bea v Cai',
    { kind: 'sides', a: { lines: ['Ana'], wrap: 2 }, b: { lines: ['Bea v Cai'], wrap: 2 } },
    'regular',
  ],
  [
    'the 200-char maximum',
    `${'A'.repeat(98)} v ${'B'.repeat(99)}`,
    {
      kind: 'sides',
      a: { lines: ['A'.repeat(98)], wrap: 2 },
      b: { lines: ['B'.repeat(99)], wrap: 2 },
    },
    'long',
  ],
] as const;
