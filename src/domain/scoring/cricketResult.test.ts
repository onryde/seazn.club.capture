import { CRICKET_MARGIN_KINDS } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { cricketResultWords } from '@/domain/scoring/cricketResult';
import type { CricketResult, CricketResultHow } from '@/domain/scoring/cricketTypes';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';

// A decided match in words (S2-4 spec §4.7): the web's own sentences (`matchCentre.result.*`), the winner by the side's
// name. Every expected string is written out.

const SIDES = {
  first: { name: 'Home CC', entrantId: 'ent-home' },
  second: { name: 'Away CC', entrantId: 'ent-away' },
} as const;

const said = (lang: 'en' | 'es' | 'fr' | 'nl', result: CricketResult) =>
  translatePad(createTranslator(lang), cricketResultWords(result, SIDES));

const won = (margin: CricketResultHow, winner: 'first' | 'second' = 'first'): CricketResult => ({
  margin,
  winner,
});

/** Every way a cricket match is decided: the engine's margin kinds, and the outcome kinds that carry no margin. */
const OUTCOME_KINDS = ['win', 'award', 'tie', 'draw', 'no_result', 'double_walkover'] as const;

describe('cricketResultWords', () => {
  it('a margin in runs, wickets or an innings and runs, the count’s own form', () => {
    expect(said('en', won({ kind: 'runs', value: 12 }))).toBe('Home CC won by 12 runs');
    expect(said('en', won({ kind: 'runs', value: 1 }, 'second'))).toBe('Away CC won by 1 run');
    expect(said('en', won({ kind: 'wickets', value: 4 }, 'second'))).toBe(
      'Away CC won by 4 wickets',
    );
    expect(said('en', won({ kind: 'wickets', value: 1 }))).toBe('Home CC won by 1 wicket');
    expect(said('en', won({ kind: 'innings_and_runs', value: 200 }))).toBe(
      'Home CC won by an innings and 200 runs',
    );
    expect(said('nl', won({ kind: 'runs', value: 12 }))).toBe('Home CC won met 12 runs');
    expect(said('fr', won({ kind: 'runs', value: 1 }))).toBe('Home CC a gagné par 1 course');
    expect(said('es', won({ kind: 'wickets', value: 3 }))).toBe('Home CC ganó por 3 wickets');
  });

  it('the super over, boundary count, a win with no margin and an award name the winner', () => {
    expect(said('en', won({ kind: 'super_over' }, 'second'))).toBe('Away CC won on the super over');
    expect(said('en', won({ kind: 'boundary_count' }))).toBe('Home CC won on boundary count');
    expect(said('en', won({ kind: 'win' }))).toBe('Home CC won');
    expect(said('en', won({ kind: 'award' }, 'second'))).toBe('Away CC awarded the match');
  });

  it('a tie, a draw, no result and a double walkover name nobody', () => {
    const none = (kind: (typeof OUTCOME_KINDS)[number]) => ({ margin: { kind }, winner: null });
    expect(said('en', none('tie'))).toBe('Match tied');
    expect(said('en', none('draw'))).toBe('Match drawn');
    expect(said('en', none('no_result'))).toBe('No result');
    expect(said('en', none('double_walkover'))).toBe('Double walkover');
    expect(said('nl', none('tie'))).toBe('Gelijkspel');
  });

  // Preflight F21's rule for words: the sweep counts what it swept, so an empty one fails.
  it('every margin kind has words in four dictionaries', () => {
    const keys = [
      ...CRICKET_MARGIN_KINDS.flatMap((kind) =>
        kind === 'super_over' || kind === 'boundary_count'
          ? [`scoring.cricket.result.${kind}`]
          : [`scoring.cricket.result.${kind}.one`, `scoring.cricket.result.${kind}.other`],
      ),
      ...OUTCOME_KINDS.map((kind) => `scoring.cricket.result.${kind}`),
    ];
    expect(keys).toHaveLength(14);
    for (const dictionary of [en, es, fr, nl] as Readonly<Record<string, string>>[]) {
      expect(keys.filter((key) => dictionary[key] === undefined)).toStrictEqual([]);
    }
  });
});
