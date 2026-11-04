import { describe, expect, it } from 'vitest';
import {
  levelSheet,
  personSheet,
  playerChosen,
  playerOptions,
} from '@/domain/scoring/setBasedSanction';

// The two sheets every set-based sport's card or sanction steps share (plan S2-2 Task 6, lifted from badminton's):
// the level asked of a side, the person asked of a side's players, and the person a choice names. The words are each
// sport's own, so the keys here are made up: the generic file names no dictionary.

type Key = 'made.title' | 'made.who' | 'made.level.low' | 'made.level.high';

const PAIR = { players: ['A. Sharma', 'R. Iyer'] } as const;
const ONE = { players: ['L. Chen'] } as const;
const NONE = { players: [] } as const;

describe('playerChosen: the player a person step’s choice names', () => {
  it('is the player at the place the option was given, counted from 0', () => {
    expect(playerChosen(PAIR, '0')).toBe('A. Sharma');
    expect(playerChosen(PAIR, '1')).toBe('R. Iyer');
    expect(playerChosen(ONE, '0')).toBe('L. Chen');
  });

  it.each(['', '2', '-1', '0.0', ' 0', '00', '1e0', 'A. Sharma', 'x'])(
    'is nobody for %j, which no option carries',
    (choice) => {
      expect(playerChosen(PAIR, choice)).toBeUndefined();
    },
  );

  it('is nobody on a side with no players, whatever is chosen', () => {
    expect(playerChosen(NONE, '0')).toBeUndefined();
  });
});

describe('playerOptions: a side’s players, each by its place', () => {
  it('lists the pair as typed, a plain choice each', () => {
    expect(playerOptions<Key>(PAIR)).toEqual([
      { id: '0', label: 'A. Sharma', tone: 'standard' },
      { id: '1', label: 'R. Iyer', tone: 'standard' },
    ]);
  });

  it('lists a singles side’s one player, and a side with no players nothing', () => {
    expect(playerOptions<Key>(ONE)).toEqual([{ id: '0', label: 'L. Chen', tone: 'standard' }]);
    expect(playerOptions<Key>(NONE)).toEqual([]);
  });

  it('gives an id that playerChosen reads back, for every option', () => {
    const named = playerOptions<Key>(PAIR).map((option) => playerChosen(PAIR, option.id));
    expect(named).toEqual(['A. Sharma', 'R. Iyer']);
  });
});

describe('levelSheet and personSheet: what each step asks', () => {
  it('asks the level under the title given, naming the side, with the options given', () => {
    const options = [
      { id: 'low', label: { key: 'made.level.low' }, tone: 'standard' },
      { id: 'high', label: { key: 'made.level.high' }, tone: 'destructive' },
    ] as const;
    expect(levelSheet<Key>({ key: 'made.title' }, PAIR, options)).toEqual({
      title: { key: 'made.title' },
      body: 'A. Sharma / R. Iyer',
      options,
    });
  });

  it('names a singles side by its one player', () => {
    expect(levelSheet<Key>({ key: 'made.title' }, ONE, []).body).toBe('L. Chen');
  });

  it('asks who under the title given, the level already chosen as the body, from that side’s players only', () => {
    expect(personSheet<Key>({ key: 'made.who' }, PAIR, { key: 'made.level.high' })).toEqual({
      title: { key: 'made.who' },
      body: { key: 'made.level.high' },
      options: [
        { id: '0', label: 'A. Sharma', tone: 'standard' },
        { id: '1', label: 'R. Iyer', tone: 'standard' },
      ],
    });
  });
});
