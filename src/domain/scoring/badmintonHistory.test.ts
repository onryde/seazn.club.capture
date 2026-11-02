import { describe, expect, it } from 'vitest';
import { badmintonHistory, type BadmintonHistoryEntry } from '@/domain/scoring/badmintonHistory';
import type { BadmintonDisplay } from '@/domain/scoring/badmintonPad';

// Owner ruling 21 (2026-10-31), History, view only: newest first, grouped by game ("Game 2", "Game 1"); one row per entry
// with what it did in the last-tap line's words, the score after it where it applies, who recorded it, and an entry Undo
// took back left in its place. The expected keys are the dictionary's (`scoring.badminton.last.*`), the scores the
// ruling's form ("7–3", top first).

const SIDES: BadmintonDisplay['sides'] = {
  first: { players: ['A. Sharma'] },
  second: { players: ['L. Chen'] },
};

const rally = (
  side: 'first' | 'second',
  game: number,
  after: readonly [number, number],
  more: Partial<Pick<BadmintonHistoryEntry, 'own' | 'undone' | 'sending'>> & {
    readonly won?: 'none' | 'game' | 'match';
  } = {},
): BadmintonHistoryEntry => ({
  did: { kind: 'rally', side, won: more.won ?? 'none', game },
  game,
  after: { first: after[0], second: after[1] },
  own: more.own ?? true,
  undone: more.undone ?? false,
  sending: more.sending ?? false,
});

describe('badmintonHistory', () => {
  it('lists nothing when nothing is recorded', () => {
    expect(badmintonHistory([], SIDES)).toEqual([]);
  });

  // Owner, 2026-11-01: the start is an entry, said as the last-tap line says it, with no score of its own.
  it('lists the start under game 1 as "Match started", the side picked named, with no score', () => {
    const [game1] = badmintonHistory(
      [
        {
          did: { kind: 'start', server: 'second' },
          game: 1,
          after: { first: 0, second: 0 },
          own: true,
          undone: false,
          sending: false,
        },
      ],
      SIDES,
    );
    expect(game1?.rows).toEqual([
      {
        said: { key: 'scoring.badminton.last.start', vars: { side: 'L. Chen' } },
        score: null,
        by: 'thisPhone',
        undone: false,
        sending: false,
      },
    ]);
  });

  it('groups by game, the latest game first and each game’s newest entry first', () => {
    const groups = badmintonHistory(
      [
        rally('first', 1, [1, 0], { own: false }),
        rally('first', 1, [21, 19], { won: 'game' }),
        rally('second', 2, [0, 1]),
        rally('first', 2, [1, 1]),
      ],
      SIDES,
    );
    expect(groups.map((group) => group.heading)).toEqual([
      { key: 'scoring.badminton.gameHeading', vars: { game: 2 } },
      { key: 'scoring.badminton.gameHeading', vars: { game: 1 } },
    ]);
    expect(groups.map((group) => group.rows.map((row) => row.score))).toEqual([
      ['1–1', '0–1'],
      ['21–19', '1–0'],
    ]);
  });

  it('says what each rally did in the last-tap line’s words, the game won included, and who recorded it', () => {
    const [game1] = badmintonHistory(
      [rally('second', 1, [0, 1], { own: false }), rally('first', 1, [21, 19], { won: 'game' })],
      SIDES,
    );
    expect(game1?.rows).toEqual([
      {
        said: { key: 'scoring.badminton.last.game', vars: { game: 1, side: 'A. Sharma' } },
        score: '21–19',
        by: 'thisPhone',
        undone: false,
        sending: false,
      },
      {
        said: { key: 'scoring.badminton.last.rally', vars: { side: 'L. Chen' } },
        score: '0–1',
        by: 'otherScorer',
        undone: false,
        sending: false,
      },
    ]);
  });

  it('leaves an entry Undo took back in its place, with what it did and its score then', () => {
    const [game] = badmintonHistory(
      [
        rally('first', 1, [1, 0]),
        rally('first', 1, [2, 0], { undone: true }),
        rally('second', 1, [1, 1]),
      ],
      SIDES,
    );
    expect(game?.rows.map((row) => [row.said.vars?.side, row.score, row.undone])).toEqual([
      ['L. Chen', '1–1', false],
      ['A. Sharma', '2–0', true],
      ['A. Sharma', '1–0', false],
    ]);
  });

  it('gives no score for a sanction, a set score or an ending: they do not move the score, or say it already', () => {
    const at = { first: 9, second: 4 };
    const entries: BadmintonHistoryEntry[] = [
      {
        did: { kind: 'setScore', first: 9, second: 4 },
        game: 2,
        after: at,
        own: true,
        undone: false,
        sending: false,
      },
      {
        did: { kind: 'sanction', side: 'first', level: 'disqualification', person: 'A. Sharma' },
        game: 2,
        after: at,
        own: true,
        undone: false,
        sending: false,
      },
      {
        did: { kind: 'ending', side: 'first', person: 'A. Sharma' },
        game: 2,
        after: at,
        own: false,
        undone: false,
        sending: false,
      },
    ];
    const [game2] = badmintonHistory(entries, SIDES);
    expect(game2?.rows).toEqual([
      {
        said: { key: 'scoring.badminton.last.ending', vars: { person: 'A. Sharma' } },
        score: null,
        by: 'otherScorer',
        undone: false,
        sending: false,
      },
      {
        said: {
          key: 'scoring.badminton.last.sanction',
          vars: { level: { key: 'scoring.sanction.disqualification' }, person: 'A. Sharma' },
        },
        score: null,
        by: 'thisPhone',
        undone: false,
        sending: false,
      },
      {
        said: { key: 'scoring.badminton.last.setScore', vars: { score: '9–4' } },
        score: null,
        by: 'thisPhone',
        undone: false,
        sending: false,
      },
    ]);
  });

  // Design §6.4 (plan S2-1 Task 7): this phone's taps the server has not accepted yet show on top, marked as sending.
  it('marks a tap still on its way as sending, on top of its game', () => {
    const [game] = badmintonHistory(
      [rally('first', 1, [1, 0]), rally('second', 1, [1, 1], { sending: true })],
      SIDES,
    );
    expect(game?.rows.map((row) => [row.score, row.by, row.sending])).toEqual([
      ['1–1', 'thisPhone', true],
      ['1–0', 'thisPhone', false],
    ]);
  });

  it('says a start whose first server is not known as "Match started" alone', () => {
    const [game1] = badmintonHistory(
      [
        {
          did: { kind: 'start', server: null },
          game: 1,
          after: { first: 0, second: 0 },
          own: false,
          undone: false,
          sending: false,
        },
      ],
      SIDES,
    );
    expect(game1?.rows[0]?.said).toEqual({ key: 'scoring.badminton.last.startUnknownServer' });
  });

  it('names a doubles side as the match label joins it, and the match won', () => {
    const doubles: BadmintonDisplay['sides'] = {
      first: { players: ['A. Sharma', 'R. Iyer'] },
      second: { players: ['L. Chen', 'M. Wong'] },
    };
    const [game] = badmintonHistory([rally('second', 3, [19, 21], { won: 'match' })], doubles);
    expect(game?.rows[0]?.said).toEqual({
      key: 'scoring.badminton.last.match',
      vars: { side: 'L. Chen / M. Wong' },
    });
  });
});
