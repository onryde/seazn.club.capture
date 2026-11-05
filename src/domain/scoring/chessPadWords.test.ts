import { DECISIVE_METHODS, DRAWN_METHODS } from '@seazn/engine/sports/boardgame';
import { describe, expect, it } from 'vitest';
import { chessHistory } from '@/domain/scoring/chessHistory';
import { chessPad } from '@/domain/scoring/chessPad';
import type { ChessDisplay, ChessLastTap, ChessMethod } from '@/domain/scoring/chessTypes';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { chessDisplay } from '../../../test/chessLedger';

// The words the chess pad names are dictionary keys (plan S2-3 Task 3): in all four languages, with no dead key left
// behind. The kit takes `PadView<MessageKey>`, so a key the dictionaries lack fails to compile where the kit takes it
// (`chessPadKeys.test-d.ts`); this proves it at run time too, and that every `scoring.chess.*` key is used by something.

const METHODS: readonly ChessMethod[] = [...new Set([...DECISIVE_METHODS, ...DRAWN_METHODS])];

const decided = (over: Partial<ChessDisplay>) => chessPad(chessDisplay({ phase: 'done', ...over }));

const views = [
  chessPad(chessDisplay({ phase: 'notStarted' })),
  chessPad(chessDisplay({ phase: 'notStarted', colorOfHome: null })),
  chessPad(chessDisplay()),
  chessPad(chessDisplay({ colorOfHome: 'B' })),
  chessPad(chessDisplay({ colorOfHome: null })),
  chessPad(chessDisplay({ phase: 'tiebreak' })),
  decided({ result: { outcome: 'white', method: 'checkmate', own: true } }),
  decided({ result: { outcome: 'draw', method: null, own: false } }),
  decided({ result: null }),
];

const lastTaps: readonly ChessLastTap[] = [
  { kind: 'start' },
  { kind: 'swap' },
  { kind: 'result', winner: 'first', method: null },
  { kind: 'result', winner: null, method: null },
  ...METHODS.flatMap((method) => [
    { kind: 'result', winner: 'second', method } as const,
    { kind: 'result', winner: null, method } as const,
  ]),
  { kind: 'undone', tap: { kind: 'result', winner: 'first', method: 'resign' } },
  { kind: 'undone', tap: { kind: 'swap' } },
];

/** Every `key` in a value, nested fills included. */
function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([name, one]) =>
    name === 'key' && typeof one === 'string' ? [one] : keysIn(one),
  );
}

const NAMES = { first: 'A. Sharma', second: 'L. Chen' } as const;

/** History's heading, named by a game with one entry in it (a game with none has no group). */
const historyKeys = keysIn(
  chessHistory(
    [
      {
        did: { kind: 'start' },
        game: 1,
        after: { first: 0, second: 0 },
        own: true,
        undone: false,
        sending: false,
      },
    ],
    NAMES,
  ),
);

const named = new Set([
  ...keysIn(views),
  ...lastTaps.flatMap((lastTap) => keysIn(chessPad(chessDisplay({ lastTap })).lastTap)),
  ...historyKeys,
]);

/** The sheet's own words: the screen draws them, the pad names none (the How sheet's title and its Record). */
const SCREENS_OWN = [
  'scoring.chess.how.won',
  'scoring.chess.how.drawn',
  'scoring.chess.how.record',
] as const;

describe('the chess pad: its words', () => {
  it('names every method the engine offers, each under its own key', () => {
    expect(METHODS).toHaveLength(11);
    for (const method of METHODS)
      expect(named.has(`scoring.chess.method.${method}`), method).toBe(true);
  });

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s has every key the pad names, and the sheet’s own',
    (_lang, dictionary: Readonly<Record<string, string>>) => {
      const missing = [...named, ...SCREENS_OWN].filter((key) => !(key in dictionary));
      expect(missing).toEqual([]);
    },
  );

  it('leaves no scoring.chess key unused: each is named by the pad or is the sheet’s own', () => {
    const unnamed = Object.keys(en).filter(
      (key) =>
        key.startsWith('scoring.chess.') &&
        !named.has(key) &&
        !(SCREENS_OWN as readonly string[]).includes(key),
    );
    expect(unnamed).toEqual([]);
  });

  // Chip words are mixed case in the dictionary: the plate's text role uppercases them on screen, and a screen reader reads
  // the same word the plate shows.
  it('writes the chip words in mixed case, in all four languages', () => {
    for (const dictionary of [en, es, fr, nl] as readonly Readonly<Record<string, string>>[]) {
      for (const key of ['scoring.chess.chip.white', 'scoring.chess.chip.black']) {
        const word = dictionary[key] ?? '';
        expect(word, key).not.toBe('');
        expect(word, key).not.toBe(word.toUpperCase());
      }
    }
  });
});
