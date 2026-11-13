import { describe, expect, it } from 'vitest';
import type { PadHistoryRow } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import { foldTennis } from '@/domain/scoring/tennisFold';
import { folded, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import type { TennisPadKey } from '@/domain/scoring/tennisTypes';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  DOUBLES,
  SINGLES,
  abandon,
  award,
  forfeit,
  interruption,
  judgedLedgerOf,
  point,
  points,
  queuedOf,
  sanction,
  start,
  summary,
  voiding,
  type Spec,
} from '../../../test/tennisLedger';

// S2-7 Task 8 (rulings 225, 226): History is the ledger as the pad says it, one row for each event the pad has words for.
// Every expected row is written out from the spec; the ledger is built through the real engine.

type Row = PadHistoryRow<TennisPadKey>;

function history(
  specs: readonly Spec[],
  more: { bootstrap?: Bootstrap; own?: readonly string[]; queued?: readonly QueuedEvent[] } = {},
) {
  const bootstrap = more.bootstrap ?? SINGLES;
  const result = foldTennis({
    bootstrap,
    ledger: judgedLedgerOf(bootstrap, specs),
    queued: more.queued ?? [],
    ownEventIds: more.own ?? [],
    toss: null,
  });
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result.history;
}

/** Every row, newest first, across the groups (a group is a game, ruling 238). */
const rows = (specs: readonly Spec[]): readonly Row[] =>
  history(specs).flatMap((group) => group.rows);
const ANA = 'Ana Ruiz';
const BEA = 'Bea Lund';

describe('History: a point', () => {
  it('says who won it and gives the call after it, newest first, the start last', () => {
    const got = rows([start(), ...points('HAHH')]);
    expect(got.map((row) => row.score)).toEqual(['40–15', '30–15', '15–15', '15–0', null]);
    expect(got[0]?.said).toEqual({ key: 'scoring.tennis.last.point', vars: { side: ANA } });
    expect(got[4]?.said).toEqual({ key: 'scoring.tennis.last.start' });
  });

  it('a point that wins a game gives the games, and says the game', () => {
    const got = rows([start(), ...gamesOf('HA'), ...points('HH')]);
    // games 1–1, then two points: 15–0, 30–0
    expect(got.slice(0, 2).map((row) => row.score)).toEqual(['30–0', '15–0']);
    const closing = rows([start(), ...gamesOf('HA')]);
    expect(closing[0]?.score).toBe('1–1');
    expect(closing[0]?.said).toEqual({ key: 'scoring.tennis.last.game', vars: { side: BEA } });
    expect(closing[4]?.score).toBe('1–0');
  });

  it('shows advantage as AD and deuce as 40–40', () => {
    const got = rows([start(), ...points('HAHAHAH')]);
    expect(got.slice(0, 3).map((row) => row.score)).toEqual(['AD–40', '40–40', '40–30']);
  });

  it('a tie-break point gives the breaker’s points', () => {
    const sixAll = [start(), ...gamesOf('HAHAHAHAHAHA')];
    const got = rows([...sixAll, ...points('HAH')]);
    expect(got.slice(0, 3).map((row) => row.score)).toEqual(['2–1', '1–1', '1–0']);
  });

  it('a set closed by a point is in its own game, says the set, and gives the games', () => {
    const groups = history([start(), ...gamesOf('HHHHHH'), point('A')]);
    expect(groups).toHaveLength(7);
    expect(groups[0]?.rows).toHaveLength(1);
    expect(groups[0]?.rows[0]?.score).toBe('0–15');
    const closing = groups[1]?.rows[0];
    expect(closing?.score).toBe('6–0');
    expect(closing?.said).toEqual({
      key: 'scoring.tennis.last.set',
      vars: { set: 1, side: ANA },
    });
  });

  it('the match point says the match', () => {
    const won = rows([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(won[0]?.said).toEqual({ key: 'scoring.tennis.last.match', vars: { side: ANA } });
    expect(won[0]?.score).toBe('6–0');
  });

  it('a tie-break set closed by a point gives the games, 7–6', () => {
    const got = rows([start(), ...gamesOf('HAHAHAHAHAHA'), ...points('HHHHHHH')]);
    expect(got[0]?.score).toBe('7–6');
  });
});

// S2-7 Task 18 (ruling 238): a group for each game. The heading names the set, the game and the side serving it, and who won it
// once it is over; a point that closes a game is in that game, never the next. Written out from the games played: Ana (home)
// serves game 1, the engine alternates, and the tie-break and the match tie-break have headings of their own.
describe('History: a group for each game (ruling 238)', () => {
  const H = 'scoring.tennis.history.';
  const PAIR = 'Ruiz / Vega h1 / Ruiz / Vega h2';
  const headings = (specs: readonly Spec[], bootstrap?: Bootstrap) =>
    history(specs, bootstrap === undefined ? {} : { bootstrap }).map((group) => group.heading);

  it('heads the game under way with its set, its number and its server, newest first, the start in game 1', () => {
    const groups = history([start(), point('H'), point('A')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.heading).toEqual({ key: `${H}game`, vars: { set: 1, game: 1, server: ANA } });
    expect(groups[0]?.rows).toHaveLength(3);
  });

  it('says who won a game once it is over, and puts the point that closed it in that game, not the next', () => {
    const groups = history([start(), ...gamesOf('H'), point('A')]);
    expect(groups.map((group) => group.heading)).toEqual([
      { key: `${H}game`, vars: { set: 1, game: 2, server: BEA } },
      { key: `${H}gameWon`, vars: { set: 1, game: 1, server: ANA, winner: ANA } },
    ]);
    expect(groups[0]?.rows).toHaveLength(1);
    expect(groups[1]?.rows).toHaveLength(5);
    expect(groups[1]?.rows[0]?.score).toBe('1–0');
  });

  it('closes a game with an award, the winner the awarded side, and counts it in the numbering', () => {
    expect(headings([start(), award('A'), point('H')])).toEqual([
      { key: `${H}game`, vars: { set: 1, game: 2, server: BEA } },
      { key: `${H}gameWon`, vars: { set: 1, game: 1, server: ANA, winner: BEA } },
    ]);
  });

  it('puts a violation or a break in the game under way, and one recorded after a game in the next', () => {
    const groups = history([
      start(),
      ...gamesOf('H'),
      sanction('A', 'warning'),
      interruption('heat'),
      point('A'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.rows).toHaveLength(3);
    expect(groups[0]?.heading).toMatchObject({ key: `${H}game`, vars: { game: 2 } });
  });

  it('names a doubles side by its names, as the pad does', () => {
    expect(headings([start()], DOUBLES)).toEqual([
      { key: `${H}game`, vars: { set: 1, game: 1, server: PAIR } },
    ]);
  });

  it('numbers the games of the next set again from 1, with the set', () => {
    const groups = headings([start(), ...gamesOf('HHHHHH'), point('A')]);
    expect(groups[0]).toEqual({ key: `${H}game`, vars: { set: 2, game: 1, server: ANA } });
    expect(groups[1]).toEqual({
      key: `${H}gameWon`,
      vars: { set: 1, game: 6, server: BEA, winner: ANA },
    });
  });

  it('heads a set tie-break "Set N · Tie-break", and who won it once it is over', () => {
    const six = [start(), ...gamesOf('HAHAHAHAHAHA')];
    expect(headings([...six, point('H')])[0]).toEqual({ key: `${H}tiebreak`, vars: { set: 1 } });
    expect(headings([...six, ...points('HHHHHHH')])[0]).toEqual({
      key: `${H}tiebreakWon`,
      vars: { set: 1, winner: ANA },
    });
    expect(headings([...six, point('H')])[1]).toMatchObject({
      key: `${H}gameWon`,
      vars: { game: 12 },
    });
  });

  it('keeps the game that makes 6-6 a game, even when it is a single awarded entry (not the tie-break it leads to)', () => {
    // Games 1-11 alternate from Ana (6-5), then Bea is awarded game 12: 6-6, no tie-break point yet.
    const got = headings([start(), ...gamesOf('HAHAHAHAHAH'), award('A')]);
    expect(got[0]).toMatchObject({ key: `${H}gameWon`, vars: { set: 1, game: 12, winner: BEA } });
  });

  it('heads a Set score "Set N" with no game, and the match tie-break "Match tiebreak"', () => {
    const noAd = {
      ...SINGLES,
      cfg: {
        bestOf: 3,
        set: { gamesTo: 6, winBy: 2, tiebreakAt: 6, tiebreakTo: 7 },
        finalSet: { matchTiebreakTo: 10 },
        game: { noAd: true },
        tiebreak: { winBy: 2 },
        points: { win: 2, loss: 0 },
      },
    };
    const got = headings([start(), summary(6, 3), summary(3, 6), point('H')], noAd);
    expect(got.slice(0, 3)).toEqual([
      { key: `${H}matchTiebreak` },
      { key: 'scoring.tennis.setHeading', vars: { set: 2 } },
      { key: 'scoring.tennis.setHeading', vars: { set: 1 } },
    ]);
    const won = headings([start(), summary(6, 3), summary(3, 6), ...points('HHHHHHHHHH')], noAd);
    expect(won[0]).toEqual({ key: `${H}matchTiebreakWon`, vars: { winner: ANA } });
  });

  it('names the server after a set score with an odd number of games: away serves set 2’s first game', () => {
    expect(headings([start(), summary(6, 3), point('H')])[0]).toEqual({
      key: `${H}game`,
      vars: { set: 2, game: 1, server: BEA },
    });
    expect(headings([start(), summary(6, 3), ...gamesOf('H')])[0]).toEqual({
      key: `${H}gameWon`,
      vars: { set: 2, game: 1, server: BEA, winner: ANA },
    });
  });

  it('does not name a winner for a game whose closing point was undone', () => {
    expect(headings([start(), ...gamesOf('H'), voiding(5)])[0]).toEqual({
      key: `${H}game`,
      vars: { set: 1, game: 1, server: ANA },
    });
  });

  it('is empty for no events and the same on a second call', () => {
    expect(headings([])).toEqual([]);
    const specs = [start(), ...gamesOf('HA')];
    expect(headings(specs)).toEqual(headings(specs));
  });
});

describe('History: every other event the pad sends', () => {
  it('a set score says the score as it is written, with the tie-break loser’s points, and gives no score', () => {
    const got = rows([start(), summary(7, 6, { home: 7, away: 5 })]);
    expect(got[0]?.said).toEqual({
      key: 'scoring.tennis.last.setScore',
      vars: { score: '7–6(5)' },
    });
    expect(got[0]?.score).toBeNull();
    const plain = rows([start(), summary(6, 4)]);
    expect(plain[0]?.said).toEqual({ key: 'scoring.tennis.last.setScore', vars: { score: '6–4' } });
  });

  it('a violation says its level and the side; a doubles person by the ledger name', () => {
    const singles = rows([start(), point('H'), sanction('A', 'warning')]);
    expect(singles[0]?.said).toEqual({
      key: 'scoring.tennis.last.violation',
      vars: { level: { key: 'scoring.tennis.level.warning' }, person: BEA },
    });
    const named = rows([start(), sanction('H', 'point_penalty', 'h2')]);
    const doubles = history([start(), sanction('H', 'point_penalty', 'h2')], {
      bootstrap: DOUBLES,
    });
    expect(named).toHaveLength(2);
    expect(doubles[0]?.rows[0]?.said).toEqual({
      key: 'scoring.tennis.last.violation',
      vars: { level: { key: 'scoring.tennis.level.pointPenalty' }, person: 'Ruiz / Vega h2' },
    });
  });

  it('a web default reads as Default, never blank', () => {
    const got = rows([start(), sanction('A', 'default')]);
    expect(got[0]?.said).toEqual({
      key: 'scoring.tennis.last.violation',
      vars: { level: { key: 'scoring.tennis.level.default' }, person: BEA },
    });
  });

  it('a person the sheet no longer lists reads Player, not blank', () => {
    const doubles = history([start(), sanction('H', 'warning', 'gone')], { bootstrap: DOUBLES });
    expect(doubles[0]?.rows[0]?.said).toEqual({
      key: 'scoring.tennis.last.violation',
      vars: {
        level: { key: 'scoring.tennis.level.warning' },
        person: { key: 'scoring.tennis.player' },
      },
    });
  });

  it('an award says the side', () => {
    const got = rows([start(), award('A')]);
    expect(got[0]?.said).toEqual({ key: 'scoring.tennis.last.award', vars: { side: BEA } });
    expect(got[0]?.score).toBeNull();
  });

  it('a break says its kind, and its side when it has one', () => {
    const both = rows([start(), interruption('heat')]);
    expect(both[0]?.said).toEqual({
      key: 'scoring.tennis.last.break',
      vars: { kind: { key: 'scoring.tennis.break.kind.heat' } },
    });
    const forOne = rows([start(), interruption('medical', 'H')]);
    expect(forOne[0]?.said).toEqual({
      key: 'scoring.tennis.last.breakFor',
      vars: { kind: { key: 'scoring.tennis.break.kind.medical' }, side: ANA },
    });
  });

  it('a web forfeit reads "Retired · {side}", an abandon "Abandoned", in the set they came in', () => {
    const retired = rows([start(), point('H'), forfeit('A', 'retired')]);
    expect(retired[0]?.said).toEqual({
      key: 'scoring.tennis.ending.by',
      vars: { ending: { key: 'scoring.tennis.ending.retired' }, side: BEA },
    });
    expect(retired[0]?.score).toBeNull();
    const abandoned = rows([start(), point('H'), abandon('rain')]);
    expect(abandoned[0]?.said).toEqual({ key: 'scoring.tennis.ending.abandoned' });
  });

  it('a double walkover has no side, just the word', () => {
    const both = { type: 'core.forfeit', payload: { by: 'both', reason: 'walkover' } };
    expect(rows([start(), both])[0]?.said).toEqual({ key: 'scoring.tennis.ending.walkover' });
  });

  it('an event the pad has no words for is no row (a note)', () => {
    const note = { type: 'core.note', payload: { text: 'rain' } };
    expect(rows([start(), note])).toHaveLength(1);
  });
});

describe('History: who, undone, sending', () => {
  it('own events say this phone; another scorer’s say another scorer', () => {
    const got = rows([start(), point('H'), point('A')]);
    expect(got.map((row) => row.by)).toEqual(['otherScorer', 'otherScorer', 'otherScorer']);
    const own = history([start(), point('H'), point('A')], { own: ['ev-3'] })[0]?.rows ?? [];
    expect(own.map((row) => row.by)).toEqual(['thisPhone', 'otherScorer', 'otherScorer']);
  });

  it('a voided event keeps its row, marked undone, with its words, and the void is no row', () => {
    const got = rows([start(), point('H'), point('A'), voiding(3)]);
    expect(got.map((row) => row.undone)).toEqual([true, false, false]);
    expect(got[0]?.said).toEqual({ key: 'scoring.tennis.last.point', vars: { side: BEA } });
    expect(got[0]?.score).toBe('15–15');
    expect(got).toHaveLength(3);
  });

  it('this phone’s queued tap is a sending row on top', () => {
    const got = history([start()], { queued: [queuedOf('q1', point('H'))] })[0]?.rows ?? [];
    expect(got[0]).toMatchObject({ sending: true, by: 'thisPhone', score: '15–0' });
    expect(got[1]?.sending).toBe(false);
  });

  it('an empty ledger has no history', () => {
    expect(history([])).toEqual([]);
  });

  it('is the same on a second call over the same input (pure)', () => {
    const specs = [start(), ...points('HAHH')];
    expect(history(specs)).toEqual(history(specs));
  });
});

describe('History is the fold’s own (a decided match through the generic accessor)', () => {
  it('a folded result carries the history the pad shows', () => {
    const result = folded([start(), point('H')]);
    expect(result.history[0]?.rows).toHaveLength(2);
  });
});
