/**
 * Spec §2's seven owed cases, then five the Task 2 review owes (I1, M1, M2),
 * each with what §2's display rule says it shows. Every expectation is written
 * out by hand from §2's rule text, or from the owner's Q4 answer, never read
 * from the module under test. Shared by the domain test and the component's
 * test, which shows the same twelve.
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
  [
    'side B alone over 26',
    `Ana v ${'B'.repeat(27)}`,
    // Review I1: side A is 3 characters with no partners, so only side B's length makes it long.
    { kind: 'sides', a: { lines: ['Ana'], wrap: 2 }, b: { lines: ['B'.repeat(27)], wrap: 2 } },
    'long',
  ],
  [
    'partners on one side only',
    'Ana Ruiz v Cai Wen / Dee Roy',
    // Review I1, Q4 option A: EITHER side with partners is long. Every line is 8 characters or fewer.
    {
      kind: 'sides',
      a: { lines: ['Ana Ruiz'], wrap: 2 },
      b: { lines: ['Cai Wen', 'Dee Roy'], wrap: 1 },
    },
    'long',
  ],
  [
    'three partners on a side',
    'Ana / Bea / Cai v Dee Roy',
    // Review M1: more than two partners is the side as typed, one block that wraps to two
    // lines (one partner a line would be three). It still has partners, so Q4 makes it long:
    // its longest line is 15 characters, so nothing else does.
    {
      kind: 'sides',
      a: { lines: ['Ana / Bea / Cai'], wrap: 2 },
      b: { lines: ['Dee Roy'], wrap: 2 },
    },
    'long',
  ],
  [
    'an emoji is one character, at the turn',
    `${'A'.repeat(25)}🎾 v Bea`,
    // Review M2: side A is 26 characters (code points), so §2 keeps it regular. Counted in
    // UTF-16 units it would be 27, and long.
    {
      kind: 'sides',
      a: { lines: [`${'A'.repeat(25)}🎾`], wrap: 2 },
      b: { lines: ['Bea'], wrap: 2 },
    },
    'regular',
  ],
  [
    'a team name with emoji',
    'Ana Ruiz v Los Volantes de Sevilla 🏸🏸',
    // Review M2: side B is 26 characters (code points) but 28 UTF-16 units: regular by
    // §2's count, long by the other.
    {
      kind: 'sides',
      a: { lines: ['Ana Ruiz'], wrap: 2 },
      b: { lines: ['Los Volantes de Sevilla 🏸🏸'], wrap: 2 },
    },
    'regular',
  ],
] as const;
