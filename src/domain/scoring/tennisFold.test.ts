import { describe, expect, it } from 'vitest';
import { display, foldBare, folded, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import {
  DOUBLES,
  DOUBLES_NOAD_CFG,
  FAST4_CFG,
  SINGLES,
  point,
  points,
  queuedOf,
  sanction,
  start,
  summary,
  voiding,
  withCfg,
  award,
  interruption,
  toss,
} from '../../../test/tennisLedger';

// S2-7 Task 4 (rulings 216, 222-225, 229; G1): the pad's display is the server's ledger folded through @seazn/engine with
// this phone's legal queued taps on top. Every expected value is written out from the ITF Rules of Tennis (5: scoring in a
// game, 5(b) the tie-break, 10: change of ends) and the spec, never computed by the fold. Top half = home. Ledgers go
// through the real engine (`judgedLedgerOf`), so none is one a server refuses.

describe('the call', () => {
  it('before any point the serve ball is the first side: the engine opens with home serving (ruling 216)', () => {
    expect(display([start()]).serving).toBe('first');
  });

  it('there is no breaker and no note in an ordinary game', () => {
    const shown = display([start(), point('H')]);
    expect(shown.breaker).toBeNull();
    expect(shown.note).toBeNull();
  });

  it('two points to home read 30 and 0', () => {
    const shown = display([start(), ...points('HH')]);
    expect(shown.call).toEqual({ first: '30', second: '0' });
    expect(shown.note).toBeNull();
  });

  it('40-40 in an ad game is deuce, both 40; advantage reads AD against 40 and goes back to 40-40', () => {
    const deuce = display([start(), ...points('HHHAAA')]);
    expect(deuce.note).toBe('deuce');
    expect(deuce.call).toEqual({ first: '40', second: '40' });
    const advantage = display([start(), ...points('HHHAAAH')]);
    expect(advantage.call).toEqual({ first: 'AD', second: '40' });
    expect(advantage.note).toBeNull();
    const back = display([start(), ...points('HHHAAAHA')]);
    expect(back.call).toEqual({ first: '40', second: '40' });
    expect(back.note).toBe('deuce');
  });

  it('advantage to away reads 40 against AD', () => {
    expect(display([start(), ...points('HHHAAAA')]).call).toEqual({ first: '40', second: 'AD' });
  });

  it('40-40 in a no-ad game is the deciding point, not deuce', () => {
    const shown = display([start(), ...points('HHHAAA')], {
      bootstrap: withCfg(SINGLES, FAST4_CFG),
    });
    expect(shown.note).toBe('decidingPoint');
    expect(shown.call).toEqual({ first: '40', second: '40' });
  });

  it('a no-ad cfg and an ad cfg disagree at the same score (the note reads game.noAd, not a constant)', () => {
    const at = [start(), ...points('HHHAAA')];
    expect(display(at).note).toBe('deuce');
    expect(display(at, { bootstrap: withCfg(SINGLES, DOUBLES_NOAD_CFG) }).note).toBe(
      'decidingPoint',
    );
  });
});

describe('the breakers', () => {
  const sixAll = [start(), ...gamesOf('HAHAHAHAHAHA')];

  it('Tour 6-6 is a tie-break, calls 0 and 0', () => {
    const shown = display(sixAll);
    expect(shown.breaker).toBe('tiebreak');
    expect(shown.games).toEqual({ first: 6, second: 6 });
    expect(shown.call).toEqual({ first: '0', second: '0' });
    expect(shown.note).toBeNull();
  });

  it('the first tie-break point reads 1-0 and the serve changes (ITF 5b)', () => {
    const before = display(sixAll);
    expect(before.serving).toBe('first');
    const after = display([...sixAll, point('H')]);
    expect(after.call).toEqual({ first: '1', second: '0' });
    expect(after.serving).toBe('second');
  });

  it('a doubles no-ad match at one set all is played to a match tie-break', () => {
    const oneAll = [start(), ...gamesOf('HHHHHH'), ...gamesOf('AAAAAA')];
    const shown = display(oneAll, { bootstrap: withCfg(DOUBLES, DOUBLES_NOAD_CFG) });
    expect(shown.breaker).toBe('matchTiebreak');
    expect(shown.call).toEqual({ first: '0', second: '0' });
    expect(shown.setsWon).toEqual({ first: 1, second: 1 });
    expect(shown.set).toBe(3);
  });
});

describe('the board', () => {
  it('names a singles side by its player and a doubles side by both partners', () => {
    expect(display([start()]).sides.first.players).toEqual(['Ana Ruiz']);
    expect(display([start()]).doubles).toBe(false);
    const pairs = display([start()], { bootstrap: DOUBLES });
    expect(pairs.doubles).toBe(true);
    expect(pairs.sides.first.players).toEqual(['Ruiz / Vega h1', 'Ruiz / Vega h2']);
  });

  it('the ends change after the first game and not after the second (ITF 10)', () => {
    expect(display([start(), ...gamesOf('H')]).endsChanged).toBe(true);
    expect(display([start(), ...gamesOf('HA')]).endsChanged).toBe(false);
  });

  it('the phase reads notStarted before the start and live after it', () => {
    expect(display([]).phase).toBe('notStarted');
    expect(display([start()]).phase).toBe('live');
  });

  it("a decided match keeps the last set's games on the board and its number", () => {
    const shown = display([start(), ...gamesOf('HHHHHH'), ...gamesOf('HHHHHH')]);
    expect(shown.phase).toBe('decided');
    expect(shown.set).toBe(2);
    expect(shown.games).toEqual({ first: 6, second: 0 });
    expect(shown.setsWon).toEqual({ first: 2, second: 0 });
  });

  it('the sets won and the set number move when a set closes', () => {
    const shown = display([start(), ...gamesOf('HHHHHH')]);
    expect(shown.setsWon).toEqual({ first: 1, second: 0 });
    expect(shown.set).toBe(2);
    expect(shown.games).toEqual({ first: 0, second: 0 });
  });
});

describe('the sets over, as one line', () => {
  it("writes a tie-break set as 7–6(5) with the loser's points, then 3–6 and 6–4", () => {
    const seven = [...gamesOf('HAHAHAHAHAHA'), ...points('AAAAAHHHHHHH')];
    const set2 = gamesOf('HAHAHAAAA');
    const set3 = gamesOf('HAHAHAHAHH');
    const shown = display([start(), ...seven, ...set2, ...set3]);
    expect(shown.finished.map((one) => one.text)).toEqual(['7–6(5)', '3–6', '6–4']);
    expect(shown.finished.map((one) => one.winner)).toEqual(['first', 'second', 'first']);
    expect(shown.phase).toBe('decided');
    expect(shown.setsWon).toEqual({ first: 2, second: 1 });
  });

  it('writes a match tie-break decider as [10–7]', () => {
    const shown = display(
      [start(), ...gamesOf('HHHHHH'), ...gamesOf('AAAAAA'), ...points('AAAAAAAHHHHHHHHHH')],
      { bootstrap: withCfg(DOUBLES, DOUBLES_NOAD_CFG) },
    );
    expect(shown.finished.map((one) => one.text)).toEqual(['6–0', '0–6', '[10–7]']);
    expect(shown.finished[2]).toMatchObject({ matchTiebreak: true, tiebreak: null });
    expect(shown.phase).toBe('decided');
  });

  it('a set entered whole by Set score keeps its games, and its tie-break its points', () => {
    const shown = display([start(), summary(6, 3), summary(7, 6, { home: 7, away: 4 })]);
    expect(shown.finished.map((one) => one.text)).toEqual(['6–3', '7–6(4)']);
  });
});

describe('the serve ball after a set score (engine 9.0.0 hands the serve on, T12-F2)', () => {
  it('an odd 6-3 summary (home served game 1 of nine) leaves away to serve set 2', () => {
    expect(display([start(), summary(6, 3)]).serving).toBe('second');
  });

  it('a 7-6 summary (thirteen games, a tie-break) also leaves away to serve set 2', () => {
    expect(display([start(), summary(7, 6, { home: 7, away: 4 })]).serving).toBe('second');
  });

  it('a toss to away, then 6-3: away served game 1, so home serves set 2', () => {
    expect(display([toss('A'), start(), summary(6, 3)]).serving).toBe('first');
  });

  it("an even 6-4 summary keeps the engine's side", () => {
    expect(display([start(), summary(6, 4)]).serving).toBe('first');
  });
});

describe('the heaviest violation, per set', () => {
  it("shows the heaviest a side holds, by the engine's order, and none for a clean side", () => {
    const shown = display([
      start(),
      sanction('H', 'warning'),
      sanction('H', 'game_penalty'),
      sanction('H', 'point_penalty'),
    ]);
    expect(shown.heaviest).toEqual({ first: 'game_penalty', second: null });
  });

  it('resets when a new set starts', () => {
    const during = display([start(), sanction('A', 'warning'), ...gamesOf('HH')]);
    expect(during.heaviest).toEqual({ first: null, second: 'warning' });
    const after = display([start(), sanction('A', 'warning'), ...gamesOf('HHHHHH')]);
    expect(after.set).toBe(2);
    expect(after.heaviest).toEqual({ first: null, second: null });
  });

  it('a violation after a set closed belongs to the next set', () => {
    const shown = display([start(), ...gamesOf('HHHHHH'), sanction('H', 'point_penalty')]);
    expect(shown.heaviest).toEqual({ first: 'point_penalty', second: null });
  });

  it('an undone violation is not counted', () => {
    const shown = display([start(), sanction('H', 'game_penalty'), voiding(2)]);
    expect(shown.heaviest).toEqual({ first: null, second: null });
  });

  it('a web default shows as the heaviest', () => {
    const shown = display([start(), sanction('A', 'warning'), sanction('A', 'default')]);
    expect(shown.heaviest.second).toBe('default');
  });
});

describe('Undo', () => {
  it('taking back the point that closed a set brings the set back with its games', () => {
    const closed = [start(), ...gamesOf('HHHHH'), ...points('HHH'), point('H')];
    expect(display(closed).setsWon).toEqual({ first: 1, second: 0 });
    const undone = display([...closed, voiding(closed.length)]);
    expect(undone.setsWon).toEqual({ first: 0, second: 0 });
    expect(undone.set).toBe(1);
    expect(undone.games).toEqual({ first: 5, second: 0 });
    expect(undone.call).toEqual({ first: '40', second: '0' });
    expect(undone.finished).toEqual([]);
  });

  it('the last tap says what Undo took back, and the start has none to say', () => {
    expect(display([start(), point('H'), voiding(2)]).lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'point', side: 'first', set: 1, won: 'none' },
    });
    expect(display([start(), voiding(1)]).lastTap).toBeNull();
  });
});

describe('the last tap', () => {
  it('names a point, whether it won a game, a set or the match', () => {
    expect(display([start(), point('A')]).lastTap).toEqual({
      kind: 'point',
      side: 'second',
      set: 1,
      won: 'none',
    });
    expect(display([start(), ...points('HHHH')]).lastTap).toMatchObject({ won: 'game' });
    expect(display([start(), ...gamesOf('HHHHHH')]).lastTap).toMatchObject({ won: 'set' });
    expect(display([start(), ...gamesOf('HHHHHHHHHHHH')]).lastTap).toMatchObject({ won: 'match' });
  });

  it('names a violation with its level, an award, a break and a set score', () => {
    expect(display([start(), sanction('H', 'warning')]).lastTap).toEqual({
      kind: 'violation',
      side: 'first',
      level: 'warning',
      person: null,
    });
    expect(display([start(), award('A')]).lastTap).toEqual({ kind: 'award', side: 'second' });
    expect(display([start(), summary(6, 4)]).lastTap).toEqual({
      kind: 'setScore',
      first: 6,
      second: 4,
      tb: null,
    });
  });

  it('a person the sheet does not list reads by no name, never blank', () => {
    const shown = display([start(), sanction('H', 'warning', 'gone')], { bootstrap: DOUBLES });
    expect(shown.lastTap).toMatchObject({ kind: 'violation', person: { name: null } });
  });

  it('names a break with its kind and side, or no side for both or none', () => {
    expect(display([start(), interruption('medical', 'A')]).lastTap).toEqual({
      kind: 'break',
      breakKind: 'medical',
      side: 'second',
    });
    expect(display([start(), interruption('heat')]).lastTap).toEqual({
      kind: 'break',
      breakKind: 'heat',
      side: null,
    });
  });

  it('a set score with a tie-break keeps its points', () => {
    expect(display([start(), summary(7, 6, { home: 7, away: 4 })]).lastTap).toEqual({
      kind: 'setScore',
      first: 7,
      second: 6,
      tb: { first: 7, second: 4 },
    });
  });

  it('a doubles violation names the person by the sheet', () => {
    const shown = display([start(), sanction('H', 'warning', 'h2')], { bootstrap: DOUBLES });
    expect(shown.lastTap).toMatchObject({
      kind: 'violation',
      person: { name: 'Ruiz / Vega h2' },
    });
  });

  it('counts the points and set scores standing as score events', () => {
    expect(display([start(), ...points('HAH'), sanction('H', 'warning')]).scoreEvents).toBe(3);
    expect(display([start(), summary(6, 4)]).scoreEvents).toBe(1);
    expect(display([start(), ...points('HAH'), voiding(3)]).scoreEvents).toBe(2);
  });
});

describe("this phone's queued taps", () => {
  it('a legal queued point shows and is in legalQueued', () => {
    const result = folded([start()], { queued: [queuedOf('q1', point('H'))] });
    expect(result.legalQueued).toEqual(['q1']);
    expect(result.display.call).toEqual({ first: '15', second: '0' });
  });

  it('a queued award in a tie-break is refused by the engine: skipped and missing from legalQueued', () => {
    const sixAll = [start(), ...gamesOf('HAHAHAHAHAHA')];
    const result = folded(sixAll, {
      queued: [queuedOf('bad', award('H')), queuedOf('good', point('A'))],
    });
    expect(result.legalQueued).toEqual(['good']);
    expect(result.display.call).toEqual({ first: '0', second: '1' });
  });

  it('a queued void of an event already voided is refused (UNDO_ALREADY_VOIDED)', () => {
    const result = folded([start(), point('H'), voiding(2)], {
      queued: [queuedOf('again', voiding(2))],
    });
    expect(result.legalQueued).toEqual([]);
  });

  it('a queued Undo takes the point out of the display and makes the start the last tap', () => {
    const result = folded([start(), point('H')], { queued: [queuedOf('u', voiding(2))] });
    expect(result.legalQueued).toEqual(['u']);
    expect(result.display.call).toEqual({ first: '0', second: '0' });
  });
});

describe('a config the engine reads or does not', () => {
  it('a garbled cfg is unfoldable as cfg', () => {
    expect(foldBare(withCfg(SINGLES, { bestOf: 'many' }))).toEqual({
      kind: 'unfoldable',
      reason: 'cfg',
    });
  });

  it('a seat with no entrant is unfoldable as sides', () => {
    const bootstrap = { ...SINGLES, sides: { home: SINGLES.sides.home, away: null } };
    expect(foldBare(bootstrap)).toEqual({ kind: 'unfoldable', reason: 'sides' });
  });

  it('a best-of-1 cfg with a match tie-break (accepted by the schema, refused by the write path) still folds', () => {
    const cfg = { bestOf: 1, finalSet: { matchTiebreakTo: 10 } };
    const shown = display([start(), ...gamesOf('HH')], { bootstrap: withCfg(SINGLES, cfg) });
    expect(shown.games).toEqual({ first: 2, second: 0 });
  });
});

// S2-7 Task 16 (rulings 233, 235): the toss, and the doubles server's name. Expected values are the ITF's (Rule 9: the
// toss winner chooses to serve or receive; the pair serves its first game in the order its players name, the opponents their
// first game in theirs, and a tie-break's serve is not the turn's partner) and the spec, never read from the fold.
describe('the toss (ruling 233)', () => {
  it('a match with no toss holds none, and home serves first', () => {
    const shown = display([start()]);
    expect(shown.toss).toBeNull();
    expect(shown.serving).toBe('first');
  });

  it('a toss naming away makes away the server before and after the start, and is held', () => {
    expect(display([toss('A')]).toss).toBe('second');
    expect(display([toss('A')]).serving).toBe('second');
    const shown = display([toss('A'), start()]);
    expect(shown.serving).toBe('second');
    expect(shown.toss).toBe('second');
  });

  it('a toss naming home is held as home, and the serve is home’s', () => {
    const shown = display([toss('H'), start()]);
    expect(shown.toss).toBe('first');
    expect(shown.serving).toBe('first');
  });

  it('the serve then alternates by game from the tossed side: away, home', () => {
    expect(display([toss('A'), start(), ...gamesOf('A')]).serving).toBe('first');
  });

  it('a toss a void took back is no toss: none is held and home serves again', () => {
    const shown = display([toss('A'), voiding(1), start()]);
    expect(shown.toss).toBeNull();
    expect(shown.serving).toBe('first');
  });

  it('a toss queued by this phone is held at once, before it has gone', () => {
    const shown = display([], { queued: [queuedOf('k1', toss('A')), queuedOf('k2', start())] });
    expect(shown.toss).toBe('second');
  });

  it('the toss queued before the start is judged legal, and so is the start after it', () => {
    const queued = [queuedOf('k1', toss('A')), queuedOf('k2', start())];
    expect(folded([], { queued }).legalQueued).toEqual(['k1', 'k2']);
  });

  it('a toss queued after a toss is already held is not legal (the engine takes one)', () => {
    const queued = [queuedOf('k1', toss('A'))];
    expect(folded([toss('H')], { queued }).legalQueued).toEqual([]);
  });

  it('the toss has a History row, in the stream’s order, before the start’s', () => {
    const group = folded([toss('A'), start()]).history[0];
    expect(group?.rows.map((row) => row.said.key)).toEqual([
      'scoring.tennis.last.start',
      'scoring.tennis.last.toss',
    ]);
    expect(group?.rows[1]?.said.vars).toEqual({ side: 'Bea Lund' });
  });

  it('Undo of the toss is no line of its own: the start screen asks again', () => {
    const shown = display([toss('A'), voiding(1)]);
    expect(shown.lastTap).toBeNull();
    expect(shown.toss).toBeNull();
  });
});

describe('the doubles server’s name (ruling 235)', () => {
  const doubles = { bootstrap: DOUBLES };

  it('names the first server of the pair that serves first, by pair order', () => {
    expect(display([start()], doubles).servingPerson).toBe('Ruiz / Vega h1');
  });

  it('follows the toss: away’s first player serves the first game after a toss to away', () => {
    expect(display([toss('A'), start()], doubles).servingPerson).toBe('Lund / Berg a1');
  });

  it('follows the order: each side’s second player serves its second game', () => {
    expect(display([start(), ...gamesOf('HA')], doubles).servingPerson).toBe('Ruiz / Vega h2');
  });

  it('names nobody in a tie-break: the serve there is not the turn’s partner', () => {
    const tiebreak = display([start(), ...gamesOf('HAHAHAHAHAHA')], doubles);
    expect(tiebreak.breaker).toBe('tiebreak');
    expect(tiebreak.servingPerson).toBeNull();
    expect(tiebreak.serving).not.toBeNull();
  });

  it('after a set score of nine games, names away’s first server (away served games 2, 4, 6, 8; the next is the first again)', () => {
    const shown = display([start(), summary(6, 3)], doubles);
    expect(shown.serving).toBe('second');
    expect(shown.servingPerson).toBe('Lund / Berg a1');
  });

  it('names nobody in singles: the side is the player', () => {
    expect(display([start()]).servingPerson).toBeNull();
  });

  it('names nobody when the pair order is not declared: the side stands alone', () => {
    const undeclared = {
      ...DOUBLES,
      sides: {
        home: {
          ...DOUBLES.sides.home!,
          lineup: DOUBLES.sides.home!.lineup.map((row) => ({ ...row, pairOrder: null })),
        },
        away: DOUBLES.sides.away,
      },
    };
    const shown = display([start()], { bootstrap: undeclared });
    expect(shown.servingPerson).toBeNull();
    expect(shown.serving).toBe('first');
  });
});
