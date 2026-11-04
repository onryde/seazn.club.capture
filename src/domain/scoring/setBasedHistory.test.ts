import { describe, expect, it } from 'vitest';
import { setBasedHistory, type SetBasedHistoryEntry } from '@/domain/scoring/setBasedHistory';

// History for the set-based sports (owner ruling 21, 2026-10-31; lifted from badminton's, plan S2-2 fix round 1): newest
// game first, each game's newest entry first, an entry Undo took back in its place, a score only where the sport says.
// Driven with a made-up sport so nothing here is badminton's or table tennis's: the words are the caller's.

type Did = { readonly kind: 'point' | 'note'; readonly text: string };
type Key = 'test.heading' | 'test.said';

const words = {
  heading: (game: number) => ({ key: 'test.heading' as const, vars: { game } }),
  said: (did: Did) => ({ key: 'test.said' as const, vars: { text: did.text } }),
  scored: (did: Did) => did.kind === 'point',
};

const entry = (
  game: number,
  did: Did,
  more: Partial<Pick<SetBasedHistoryEntry<Did>, 'own' | 'undone' | 'sending' | 'after'>> = {},
): SetBasedHistoryEntry<Did> => ({
  did,
  game,
  after: more.after ?? { first: 0, second: 0 },
  own: more.own ?? true,
  undone: more.undone ?? false,
  sending: more.sending ?? false,
});

const point = (text: string): Did => ({ kind: 'point', text });
const note = (text: string): Did => ({ kind: 'note', text });

describe('setBasedHistory', () => {
  it('lists the latest game first and each game’s newest entry first', () => {
    const groups = setBasedHistory<Did, Key>(
      [
        entry(1, point('a'), { after: { first: 1, second: 0 } }),
        entry(1, point('b'), { after: { first: 1, second: 1 } }),
        entry(2, point('c'), { after: { first: 0, second: 1 } }),
      ],
      words,
    );
    expect(groups.map((group) => group.heading)).toEqual([
      { key: 'test.heading', vars: { game: 2 } },
      { key: 'test.heading', vars: { game: 1 } },
    ]);
    expect(groups.map((group) => group.rows.map((row) => row.said.vars?.text))).toEqual([
      ['c'],
      ['b', 'a'],
    ]);
  });

  it('gives the score after a scored entry, top first, and none for an unscored one', () => {
    const [group] = setBasedHistory<Did, Key>(
      [entry(1, point('p'), { after: { first: 7, second: 3 } }), entry(1, note('n'))],
      words,
    );
    expect(group?.rows.map((row) => row.score)).toEqual([null, '7–3']);
  });

  it('marks who recorded an entry, an entry Undo took back, and one still on its way, in its place', () => {
    const [group] = setBasedHistory<Did, Key>(
      [
        entry(1, point('mine'), { own: true }),
        entry(1, point('theirs'), { own: false, undone: true }),
        entry(1, point('queued'), { sending: true }),
      ],
      words,
    );
    expect(
      group?.rows.map(({ said, by, undone, sending }) => [said.vars?.text, by, undone, sending]),
    ).toEqual([
      ['queued', 'thisPhone', false, true],
      ['theirs', 'otherScorer', true, false],
      ['mine', 'thisPhone', false, false],
    ]);
  });

  it('is no group at all for nothing recorded', () => {
    expect(setBasedHistory<Did, Key>([], words)).toEqual([]);
  });

  it('puts an entry in the game it was recorded in even when the games arrive out of order', () => {
    const groups = setBasedHistory<Did, Key>([entry(2, point('b')), entry(1, point('a'))], words);
    expect(groups.map((group) => group.rows.length)).toEqual([1, 1]);
    expect(groups[0]?.rows[0]?.said.vars?.text).toBe('b');
  });

  it('does not change the entries it is given', () => {
    const entries = Object.freeze([entry(1, point('a')), entry(1, point('b'))]);
    const before = JSON.stringify(entries);
    setBasedHistory<Did, Key>(entries, words);
    setBasedHistory<Did, Key>(entries, words);
    expect(JSON.stringify(entries)).toBe(before);
  });
});
