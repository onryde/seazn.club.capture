import { tabletennisPadRules } from '@seazn/engine/pad';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { PadSide } from '@/domain/scoring/padView';
import {
  cardSheet,
  chooseCard,
  startCard,
  type CardStep,
  type CardSheet,
} from '@/domain/scoring/tableTennisSanction';
import type { TableTennisSide } from '@/domain/scoring/tableTennisPad';

// The umpire's two cards, step by step (design §4.7; the owner's ruling 52): the level (yellow is `warning`, red is
// `penalty`), then the player only if the side has more than one; a side with one player is stamped at once, and a side
// with no named player is recorded by the side. There is no confirm and no ending: table tennis declares none. Every
// expected value is written out from the design and the dictionary, never from the code under test.

const DOUBLES: TableTennisSide = { players: ['A. Sharma', 'R. Iyer'] };
const SINGLES: TableTennisSide = { players: ['L. Chen'] };
const NAMELESS: TableTennisSide = { players: [] };

const sides: Readonly<Record<PadSide, TableTennisSide>> = { first: DOUBLES, second: SINGLES };

const choose = (step: CardStep, choice: string, over = sides) => chooseCard(step, choice, over);

describe('the card flow: level, then a pair’s player, then the card', () => {
  it('starts at the level, for the side whose Card was tapped', () => {
    expect(startCard('second')).toEqual({ step: 'level', side: 'second' });
  });

  it.each(['warning', 'penalty'] as const)(
    'asks a pair’s player after the %s, and records the card with that player and no confirm',
    (level) => {
      const person = choose(startCard('first'), level);
      expect(person).toEqual({ kind: 'step', step: { step: 'person', side: 'first', level } });
      if (person.kind !== 'step') throw new Error('expected a step');
      expect(choose(person.step, '1')).toEqual({
        kind: 'record',
        card: { side: 'first', level, person: 'R. Iyer' },
      });
    },
  );

  it.each(['warning', 'penalty'] as const)(
    'skips the person step for a side with one player: the %s is recorded at once, against that player',
    (level) => {
      expect(choose(startCard('second'), level)).toEqual({
        kind: 'record',
        card: { side: 'second', level, person: 'L. Chen' },
      });
    },
  );

  it.each(['warning', 'penalty'] as const)(
    'records the %s by the side when the side has no named player, with no person',
    (level) => {
      const bare = { first: NAMELESS, second: SINGLES };
      expect(choose(startCard('first'), level, bare)).toEqual({
        kind: 'record',
        card: { side: 'first', level, person: null },
      });
    },
  );

  it('reads the side the card is for, not the first: the other side’s players are not offered', () => {
    const person = choose(startCard('first'), 'warning');
    if (person.kind !== 'step') throw new Error('expected a step');
    expect(choose(person.step, '0')).toMatchObject({
      card: { side: 'first', person: 'A. Sharma' },
    });
    expect(choose(startCard('second'), 'warning')).toMatchObject({
      card: { side: 'second', person: 'L. Chen' },
    });
  });

  it.each([
    [{ step: 'level', side: 'first' }, ['', 'Warning', 'yellow', 'red', '0']],
    // badminton's other two levels, and its confirm, are not table tennis's
    [{ step: 'level', side: 'first' }, ['expulsion', 'disqualification', 'confirm']],
    [{ step: 'person', side: 'first', level: 'penalty' }, ['', '2', '-1', '0.0', 'R. Iyer', 'x']],
  ] as const)('stays on %j for a choice it does not offer', (step, choices) => {
    for (const choice of choices) {
      expect(choose(step, choice), choice).toEqual({ kind: 'step', step });
    }
  });
});

describe('cardSheet: what each step asks', () => {
  it('asks the level, naming the side, with two levels only: yellow then red', () => {
    expect(cardSheet(startCard('first'), sides)).toEqual({
      title: { key: 'scoring.tabletennis.tool.card' },
      body: 'A. Sharma / R. Iyer',
      options: [
        { id: 'warning', label: { key: 'scoring.tabletennis.card.warning' }, tone: 'standard' },
        { id: 'penalty', label: { key: 'scoring.tabletennis.card.penalty' }, tone: 'standard' },
      ],
    });
  });

  it('offers the levels the engine lists, in its order, and no others', () => {
    expect(tabletennisPadRules.sanctionLevels).toEqual(['warning', 'penalty']);
    const ids = cardSheet(startCard('second'), sides).options.map((option) => option.id);
    expect(ids).toEqual(tabletennisPadRules.sanctionLevels);
  });

  it('names a singles side by its one player', () => {
    expect(cardSheet(startCard('second'), sides).body).toBe('L. Chen');
  });

  it('asks who, with the card chosen as the body, from that pair’s players only', () => {
    expect(cardSheet({ step: 'person', side: 'first', level: 'penalty' }, sides)).toEqual({
      title: { key: 'scoring.sanction.who' },
      body: { key: 'scoring.tabletennis.card.penalty' },
      options: [
        { id: '0', label: 'A. Sharma', tone: 'standard' },
        { id: '1', label: 'R. Iyer', tone: 'standard' },
      ],
    });
  });

  it('asks who from the other side’s own players when that side’s Card was tapped', () => {
    const other = cardSheet({ step: 'person', side: 'second', level: 'warning' }, sides);
    expect(other.options).toEqual([{ id: '0', label: 'L. Chen', tone: 'standard' }]);
  });
});

describe('the words: in every language, and as the umpire says them', () => {
  const sheets: readonly CardSheet[] = [
    cardSheet(startCard('first'), sides),
    cardSheet({ step: 'person', side: 'first', level: 'warning' }, sides),
  ];
  const keysOf = (sheet: CardSheet): string[] => [
    sheet.title.key,
    ...(typeof sheet.body === 'object' ? [sheet.body.key] : []),
    ...sheet.options.flatMap((option) =>
      typeof option.label === 'object' ? [option.label.key] : [],
    ),
  ];

  it('names a dictionary key, in all four languages, for every word the steps use', () => {
    const keys = sheets.flatMap(keysOf);
    expect(keys).toEqual([
      'scoring.tabletennis.tool.card',
      'scoring.tabletennis.card.warning',
      'scoring.tabletennis.card.penalty',
      'scoring.sanction.who',
      'scoring.tabletennis.card.warning',
    ]);
    for (const [name, dictionary] of Object.entries({ en, es, fr, nl })) {
      for (const key of keys) {
        expect(dictionary, `${name} ${key}`).toHaveProperty([key]);
      }
    }
  });

  it('says the levels as the umpire’s cards, yellow then red', () => {
    expect(en['scoring.tabletennis.card.warning']).toBe('Yellow card');
    expect(en['scoring.tabletennis.card.penalty']).toBe('Red card');
    expect(nl['scoring.tabletennis.card.warning']).toBe('Gele kaart');
    expect(nl['scoring.tabletennis.card.penalty']).toBe('Rode kaart');
  });
});
