/**
 * The match label's shapes under C2 (D2 §4.4): one string per side, partners joined by " / " as typed (an empty
 * partner dropped), or one block when the label has no two sides. Every expectation is written out by hand from the
 * spec's rule text, never read from the module under test. Shared by the domain test, the component's test and the
 * layout test.
 */
export const CASES = [
  ['short singles', 'Ana Ruiz v Bea Lima', { kind: 'sides', a: 'Ana Ruiz', b: 'Bea Lima' }],
  [
    'long singles',
    'Alexandra Konstantinopoulou v Maria Fernanda Albuquerque',
    { kind: 'sides', a: 'Alexandra Konstantinopoulou', b: 'Maria Fernanda Albuquerque' },
  ],
  [
    'doubles',
    'Ana Ruiz / Bea Lima v Cai Wen / Dee Roy',
    { kind: 'sides', a: 'Ana Ruiz / Bea Lima', b: 'Cai Wen / Dee Roy' },
  ],
  [
    'long doubles',
    'Alexandra Konstantinopoulou / Bea Lima v Cai Wen / Maria Fernanda Albuquerque Santos',
    {
      kind: 'sides',
      a: 'Alexandra Konstantinopoulou / Bea Lima',
      b: 'Cai Wen / Maria Fernanda Albuquerque Santos',
    },
  ],
  ['Match {n}', 'Match 4', { kind: 'block', text: 'Match 4' }],
  ['two " v "', 'Ana v Bea v Cai', { kind: 'sides', a: 'Ana', b: 'Bea v Cai' }],
  [
    'the 200-char maximum',
    `${'A'.repeat(98)} v ${'B'.repeat(99)}`,
    { kind: 'sides', a: 'A'.repeat(98), b: 'B'.repeat(99) },
  ],
  [
    'partners on one side only',
    'Ana Ruiz v Cai Wen / Dee Roy',
    { kind: 'sides', a: 'Ana Ruiz', b: 'Cai Wen / Dee Roy' },
  ],
  [
    'three partners on a side',
    'Ana / Bea / Cai v Dee Roy',
    { kind: 'sides', a: 'Ana / Bea / Cai', b: 'Dee Roy' },
  ],
  ['an empty partner dropped', 'Ana /  / Bea v Cai', { kind: 'sides', a: 'Ana / Bea', b: 'Cai' }],
  ['an empty side is one block', ' v Bea', { kind: 'block', text: 'v Bea' }],
  ['an empty label', '', { kind: 'block', text: '' }],
  [
    'a team name with emoji',
    'Ana Ruiz v Los Volantes de Sevilla 🏸🏸',
    { kind: 'sides', a: 'Ana Ruiz', b: 'Los Volantes de Sevilla 🏸🏸' },
  ],
] as const;
