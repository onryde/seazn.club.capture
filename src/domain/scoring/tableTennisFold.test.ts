import type { SetBasedServeContext, SetBasedServeUnknown } from '@seazn/engine/sports/setbased';
import { tabletennisPadRules } from '@seazn/engine/pad';
import { describe, expect, it } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import { foldTableTennis, needsAnchor, undoneTap } from '@/domain/scoring/tableTennisFold';
import type { TableTennisDisplay, TableTennisSanctionLevel } from '@/domain/scoring/tableTennisPad';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  DECIDED_3_0,
  DEUCE_10_10,
  DOUBLES,
  DOUBLES_BENCH,
  DOUBLES_NO_ORDER,
  GAME_ONE_11_7,
  SINGLES,
  anchored,
  expedite,
  ledgerOf,
  queuedOf,
  rallies,
  rally,
  sanction,
  start,
  summary,
  timeout,
  voiding,
  wholeGame,
  withCfg,
  type Seat,
  type Spec,
} from '../../../test/tableTennisLedger';

// Plan S2-2 Task 3 (design §4, §5.1-5.2, §6): the pad's display is the server's ledger folded through @seazn/engine with
// this phone's legal queued taps on top. Every expected value below is written out from the ITTF laws (2.13 service,
// 2.15 expedite) and the design, never computed by the fold. Top half = home, bottom = away.

// `scoreBound` is the engine's `summaryScoreBound` (kernel.ts): an uncapped sport's cap-less margin, max(setTo, finalSetTo)
// + 20, so 11 + 20 = 31 here and 21 + 20 = 41 for hardbat. The 20 is the engine's number, written out to be read.
const STANDARD_RULES = { bestOf: 5, setTo: 11, finalSetTo: 11, winBy: 2, scoreBound: 31 };
const SINGLES_SIDES: TableTennisDisplay['sides'] = {
  first: { players: ['A. Sharma'] },
  second: { players: ['L. Chen'] },
};
const SINGLES_CONTEXT: TableTennisDisplay['context'] = {
  competition: 'Spring Open 2026',
  division: 'U15 Boys Singles',
  round: 'Round 1',
  match: 'Match 4',
  sides: ['A. Sharma', 'L. Chen'],
};

function fold(
  specs: readonly Spec[],
  more: {
    readonly queued?: readonly QueuedEvent[];
    readonly own?: readonly string[];
    readonly toss?: PadSide | null;
    readonly bootstrap?: Bootstrap;
  } = {},
) {
  const input: SportFoldInput = {
    bootstrap: more.bootstrap ?? SINGLES,
    ledger: ledgerOf(specs),
    queued: more.queued ?? [],
    ownEventIds: more.own ?? [],
    toss: more.toss ?? null,
  };
  return foldTableTennis(input);
}

/** The folded result, or the test fails saying why it would not fold. */
function folded(...args: Parameters<typeof fold>) {
  const result = fold(...args);
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result;
}

const display = (...args: Parameters<typeof fold>) => folded(...args).display;

/** The home side's first point (naming home as the server), then one point per letter: `H` home's, `A` away's. */
const played = (letters: string): readonly Spec[] =>
  anchored(letters.slice(0, 1) as Seat, letters.slice(1));

/** Who is due to serve and which of the pair's two serves it is, after the points `letters` of an anchored game. */
const serveAfter = (letters: string, bootstrap: Bootstrap = SINGLES) => {
  const { server, serveNumber } = display(played(letters), { bootstrap });
  return [server, serveNumber];
};

describe('foldTableTennis: before the start', () => {
  it('opens a match nobody has started: not started, game 1 of its format, nothing to undo', () => {
    const result = folded([]);
    expect(result.display).toEqual({
      sides: SINGLES_SIDES,
      context: SINGLES_CONTEXT,
      points: { first: 0, second: 0 },
      finished: [],
      game: 1,
      rules: STANDARD_RULES,
      phase: 'notStarted',
      server: null,
      serverPerson: null,
      serverPersonId: null,
      serveNumber: null,
      serverPicked: false,
      anchorNeeded: false,
      expedite: 'off',
      deuce: false,
      records: { timeouts: true, sanctions: true, expedite: true },
      scoreEvents: 0,
      lastTap: null,
      undoable: false,
    } satisfies TableTennisDisplay);
    expect(result.legalQueued).toEqual([]);
    expect(result.history).toEqual([]);
  });

  it('shows no pick on the Start screen: a held pick before any start, or from a start since undone', () => {
    const none = { server: null, serverPicked: false, phase: 'notStarted' };
    expect(display([], { toss: 'second' })).toMatchObject(none);
    expect(display([start(), voiding(1)], { toss: 'second' })).toMatchObject(none);
  });

  it('shows this phone’s queued start at once, the side picked serving its first of two', () => {
    const result = folded([], { queued: [queuedOf('k-start', start())], toss: 'second' });
    expect(result.display).toMatchObject({
      phase: 'pre',
      points: { first: 0, second: 0 },
      server: 'second',
      serveNumber: 1,
      serverPicked: true,
      anchorNeeded: false,
      lastTap: { kind: 'start', server: 'second' },
      undoable: true,
    });
    expect(result.legalQueued).toEqual(['k-start']);
  });
});

describe('foldTableTennis: the serve', () => {
  // ITTF 2.13.3: two points each whoever wins them. Home serves first; `p` is the points played so far.
  it('alternates every two points: home 1st and 2nd, then away 1st and 2nd, and so on', () => {
    const alternatingGame = 'HAHAHAHAHA';
    const expected = [
      ['first', 2], // p=1
      ['second', 1], // p=2
      ['second', 2], // p=3
      ['first', 1], // p=4
      ['first', 2], // p=5
      ['second', 1], // p=6
      ['second', 2], // p=7
      ['first', 1], // p=8
      ['first', 2], // p=9
      ['second', 1], // p=10
    ];
    const actual = [...alternatingGame].map((_, at) =>
      serveAfter(alternatingGame.slice(0, at + 1)),
    );
    expect(actual).toEqual(expected);
  });

  // ITTF 2.13.4 (the deuce clause): from 10–10 each side serves one point in turn, the order unchanged.
  it('serves one each from 10–10, home first, and says deuce only once it is level there', () => {
    const at = (extra: string) => {
      const { server, serveNumber, deuce } = display([...DEUCE_10_10, ...rallies(extra)]);
      return [server, serveNumber, deuce];
    };
    expect(display(DEUCE_10_10).points).toEqual({ first: 10, second: 10 });
    expect(at('')).toEqual(['first', 1, true]); // 10–10
    expect(at('H')[0]).toBe('second'); // 11–10: away serves one
    expect(at('H')[1]).toBe(1);
    expect(at('HA')).toEqual(['first', 1, true]); // 11–11: home again, and still level
    expect(at('HAH')[0]).toBe('second'); // 12–11
  });

  it('is still in turns of two one point before deuce, and not yet deuce', () => {
    const nineAll = `${'AH'.repeat(8)}A`; // after the first point: 9–9
    const tenNine = `${nineAll}H`; // 10–9: away's second serve
    expect(display(played(`H${nineAll}`))).toMatchObject({
      points: { first: 9, second: 9 },
      server: 'second',
      serveNumber: 1,
      deuce: false,
    });
    expect(display(played(`H${tenNine}`))).toMatchObject({
      points: { first: 10, second: 9 },
      server: 'second',
      serveNumber: 2,
      deuce: false,
    });
  });

  // ITTF 2.13.6: the player who served first in a game receives first in the next.
  it('opens the next game with the other side serving, and the one after with the first again', () => {
    const between = display(GAME_ONE_11_7);
    expect(between).toMatchObject({
      phase: 'betweenGames',
      game: 2,
      points: { first: 0, second: 0 },
      finished: [{ points: { first: 11, second: 7 }, winner: 'first' }],
      server: 'second',
      serveNumber: 1,
    });
    const gameTwoPoint = display([...GAME_ONE_11_7, ...rallies('A')]);
    expect([gameTwoPoint.server, gameTwoPoint.serveNumber]).toEqual(['second', 2]);
    const gameThree = display([...GAME_ONE_11_7, ...rallies('A'.repeat(11))]);
    expect(gameThree).toMatchObject({
      phase: 'betweenGames',
      game: 3,
      server: 'first',
      serveNumber: 1,
    });
  });

  // ITTF 2.15.3-2.15.4: under expedite each player serves one point in turn until the end of the game; the system stays
  // in force to the end of the match (2.15.4 + the engine's reading), so the next game starts that way too.
  describe('under Expedite', () => {
    // 2–2 after four points: home's pair has just finished, so the next point is home's, with nothing cut short.
    const atTwoAll: readonly Spec[] = played('HAHA');

    it('changes the server with every point, always on its 1st', () => {
      const prefix = [...atTwoAll, expedite()];
      const letters = 'HHHH';
      const states = [...letters].map((_, at) => {
        const { server, serveNumber } = display([...prefix, ...rallies(letters.slice(0, at + 1))]);
        return [server, serveNumber];
      });
      const first = display(prefix);
      expect([first.server, first.serveNumber]).toEqual(['first', 1]);
      expect(states).toEqual([
        ['second', 1],
        ['first', 1],
        ['second', 1],
        ['first', 1],
      ]);
    });

    it('keeps changing it in the next game, which the other side opens', () => {
      const gameOne = [...atTwoAll, expedite(), ...rallies('H'.repeat(9))]; // 11–2 to home
      const opening = display(gameOne);
      expect(opening).toMatchObject({ phase: 'betweenGames', game: 2, expedite: 'inForce' });
      expect([opening.server, opening.serveNumber]).toEqual(['second', 1]);
      const afterOne = display([...gameOne, ...rallies('A')]);
      expect([afterOne.server, afterOne.serveNumber]).toEqual(['first', 1]);
    });
  });
});

describe('foldTableTennis: Expedite is offered', () => {
  // ITTF 2.15.1: not once both sides have 9 in the game (`tabletennisPadRules.expediteScoreFloor`).
  const nineEight = played(`H${'AH'.repeat(8)}`); // 9–8
  const nineAll = [...nineEight, ...rallies('A')];
  const eightNine = played(`H${'AH'.repeat(7)}AA`);

  it('at 9–8 and 8–9, not at 9–9', () => {
    expect(display(nineEight).points).toEqual({ first: 9, second: 8 });
    expect(display(nineEight).expedite).toBe('offered');
    expect(display(eightNine).points).toEqual({ first: 8, second: 9 });
    expect(display(eightNine).expedite).toBe('offered');
    expect(display(nineAll).points).toEqual({ first: 9, second: 9 });
    expect(display(nineAll).expedite).toBe('off');
    expect(display([...nineAll, ...rallies('H')]).expedite).toBe('off'); // 10–9
  });

  it('reads the floor from the engine, not a number of ours', () => {
    expect(tabletennisPadRules.expediteScoreFloor).toBe(9);
  });

  it('looks only at the game under way: a new game after 11–9 offers it again', () => {
    const afterGameOne = [...nineAll, ...rallies('HH')]; // 11–9 to home
    expect(display(afterGameOne)).toMatchObject({ phase: 'betweenGames', expedite: 'offered' });
  });

  it('once started is in force, at any score, to the end of the match', () => {
    const early = display([...played('HA'), expedite()]);
    expect(early.expedite).toBe('inForce');
    expect(display([...nineAll, expedite()]).expedite).toBe('inForce');
    expect(display([...DECIDED_3_0]).expedite).toBe('off'); // over: nothing to start
  });

  it('is not offered when the match does not record it, or before it has started, or once it is over', () => {
    const noExpedite = withCfg(SINGLES, {
      records: { timeouts: true, sanctions: true, substitutions: false, expedite: false },
    });
    const result = display(played('HA'), { bootstrap: noExpedite });
    expect(result.expedite).toBe('off');
    expect(result.records).toEqual({ timeouts: true, sanctions: true, expedite: false });
    expect(display([]).expedite).toBe('off');
    expect(display(DECIDED_3_0).expedite).toBe('off');
  });
});

describe('foldTableTennis: doubles name the server', () => {
  // ITTF 2.13.4: the pair serves in the order the team sheet declared; home's first named opens, and a side's second turn
  // is its second named. p is the points played; the server of the next point is read.
  const NAMED: readonly [string, string, string][] = [
    ['first', 'A. Sharma', 'p-sharma'], // p=1
    ['second', 'L. Chen', 'p-chen'], // p=2
    ['second', 'L. Chen', 'p-chen'], // p=3
    ['first', 'R. Iyer', 'p-iyer'], // p=4
    ['first', 'R. Iyer', 'p-iyer'], // p=5
    ['second', 'M. Wong', 'p-wong'], // p=6
    ['second', 'M. Wong', 'p-wong'], // p=7
    ['first', 'A. Sharma', 'p-sharma'], // p=8
    ['first', 'A. Sharma', 'p-sharma'], // p=9
  ];
  const game = 'HAHAHAHAH';
  const readings = (bootstrap: Bootstrap) =>
    [...game].map((_, at) => {
      const d = display(played(game.slice(0, at + 1)), { bootstrap });
      return [d.server, d.serverPerson, d.serverPersonId];
    });

  it('names the player by the team sheet’s pair order, through a game', () => {
    expect(readings(DOUBLES)).toEqual(NAMED);
  });

  it('names the side only when the team sheet declared no pair order', () => {
    expect(readings(DOUBLES_NO_ORDER)).toEqual(NAMED.map(([side]) => [side, null, null]));
  });

  it('names no singles player: the plate is the side', () => {
    const d = display(played('HAH'));
    expect([d.server, d.serverPerson, d.serverPersonId]).toEqual(['second', null, null]);
  });

  // The bootstrap carries no slot, so a bench row could make the phone name someone the web would not: ruling 3.
  it('a pair side with a bench row names no server person, and the clean pair still does', () => {
    const [home, away] = [readings(DOUBLES_BENCH)[0], readings(DOUBLES_BENCH)[1]];
    expect(home).toEqual(['first', null, null]); // p=1: home serves, with a bench row
    expect(away).toEqual(['second', 'L. Chen', 'p-chen']); // p=2: away lists exactly two
  });

  it('names no player the bootstrap does not list among its members', () => {
    const home = DOUBLES.sides.home;
    if (home === null) throw new Error('fixture has no home side');
    const unlisted: Bootstrap = {
      ...DOUBLES,
      sides: { ...DOUBLES.sides, home: { ...home, members: home.members.slice(0, 1) } },
    };
    expect(readings(unlisted)[3]).toEqual(['first', null, null]); // p=4: R. Iyer's turn, not listed
    expect(readings(unlisted)[0]).toEqual(['first', 'A. Sharma', 'p-sharma']); // p=1
  });

  it('names no player for the pick shown before the first point', () => {
    const d = display([start()], { bootstrap: DOUBLES, toss: 'first' });
    expect([d.server, d.serverPicked, d.serverPerson, d.serverPersonId]).toEqual([
      'first',
      true,
      null,
      null,
    ]);
  });
});

describe('foldTableTennis: the anchor', () => {
  const lost: readonly Spec[] = [start(), rally({ wonBy: 'H' })]; // another scorer's first point named no server

  it('is needed when a co-scorer’s first point carried no serving: no server, the pick is gone', () => {
    const d = display(lost, { toss: 'first' });
    expect(d).toMatchObject({
      server: null,
      serveNumber: null,
      serverPicked: false,
      anchorNeeded: true,
    });
  });

  it('is not needed once a point names the server, nor while the pick is shown, nor before the start', () => {
    expect(display(played('H')).anchorNeeded).toBe(false);
    expect(display([start()], { toss: 'first' }).anchorNeeded).toBe(false);
    expect(display([]).anchorNeeded).toBe(false);
  });

  // Ruling (fix round 1): the question is for any live match nobody can say the server of, a point standing or not.
  it('is needed for a match started elsewhere that has had no point: this phone picked nothing', () => {
    const d = display([start()]);
    expect(d).toMatchObject({
      phase: 'pre',
      server: null,
      serveNumber: null,
      serverPicked: false,
      anchorNeeded: true,
    });
  });

  it('is needed when game 1 was entered by Set score alone, though this phone picked at the start', () => {
    const d = display([start(), wholeGame(11, 7)], { toss: 'first' });
    expect(d).toMatchObject({ server: null, serverPicked: false, anchorNeeded: true });
  });

  it('is not needed for a match this phone started: its pick is shown at 0–0', () => {
    const d = display([], { queued: [queuedOf('k', start())], toss: 'second' });
    expect(d).toMatchObject({
      phase: 'pre',
      server: 'second',
      serverPicked: true,
      anchorNeeded: false,
    });
  });

  it('is needed again when the point that anchored it is undone, never a stale server', () => {
    const ledger = [start(), rally({ wonBy: 'H', serving: 'H' }), ...rallies('A'), voiding(2)];
    expect(display(ledger.slice(0, 3))).toMatchObject({ server: 'second', anchorNeeded: false });
    const undone = display(ledger);
    expect(undone).toMatchObject({
      points: { first: 0, second: 1 },
      server: null,
      serveNumber: null,
      anchorNeeded: true,
    });
  });

  it('is not needed when the first point is the only one undone: the pick comes back', () => {
    const ledger = [start(), rally({ wonBy: 'H', serving: 'H' }), voiding(2)];
    const d = display(ledger, { toss: 'second' });
    expect(d).toMatchObject({ server: 'second', serverPicked: true, anchorNeeded: false });
  });

  it('is mended by this phone’s queued point that names the server', () => {
    const queued = [queuedOf('k', rally({ wonBy: 'A', serving: 'A' }))];
    const d = display(lost, { queued });
    // Away served the point after home's: its first two. Two points are played, so home serves next, its first.
    expect(d).toMatchObject({
      points: { first: 1, second: 1 },
      server: 'first',
      serveNumber: 1,
      anchorNeeded: false,
    });
  });

  it('is not needed when two points disagree about who served: the engine names none, and no tile helps', () => {
    // Home served first (1–0, then its second serve); the second point says away served it: a contradiction.
    const ledger = [
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      rally({ wonBy: 'H', serving: 'A' }),
    ];
    expect(display(ledger)).toMatchObject({ server: null, serveNumber: null, anchorNeeded: false });
  });

  // The dispute blanks the game it was in, not the match: the next game opens on nothing, and a declaration re-anchors it.
  it('is needed again in the game after one whose points disagreed about the server', () => {
    const disputed = [
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      rally({ wonBy: 'H', serving: 'A' }),
      ...rallies('H'.repeat(9)),
    ];
    expect(display(disputed)).toMatchObject({
      phase: 'betweenGames',
      game: 2,
      finished: [{ points: { first: 11, second: 0 }, winner: 'first' }],
      server: null,
      anchorNeeded: true,
    });
  });

  it('is not needed once the match is decided', () => {
    expect(display(DECIDED_3_0)).toMatchObject({
      phase: 'decided',
      server: null,
      anchorNeeded: false,
    });
  });

  it('is needed after a co-scorer’s point on a ledger this phone queued the start of', () => {
    const d = display([], {
      queued: [queuedOf('k1', start()), queuedOf('k2', rally({ wonBy: 'A' }))],
      toss: 'first',
    });
    expect(d).toMatchObject({ server: null, serverPicked: false, anchorNeeded: true });
  });
});

describe('needsAnchor: the engine’s reasons it names nobody', () => {
  const unknown = (why: SetBasedServeUnknown): SetBasedServeContext => ({
    servingSide: null,
    side: null,
    serverPersonId: null,
    serveOrderKnown: false,
    unknownBecause: why,
  });
  // Every reason the engine has (a `Record` fails to compile if one is missing). Design §4.2: a new declaration can fill
  // a gap, not a dispute (`recorded-disagrees`) nor a structural mismatch (`ledger-mismatch`) that no event fixes.
  const NEEDED: Readonly<Record<SetBasedServeUnknown, boolean>> = {
    undeclared: true,
    'score-jumped': true,
    'alternation-disputed': true,
    'deciding-set-toss': true,
    'match-over': true,
    'recorded-disagrees': false,
    'ledger-mismatch': false,
  };

  it.each(Object.entries(NEEDED))('%s: %s', (why, needed) => {
    expect(needsAnchor(unknown(why as SetBasedServeUnknown), true, false)).toBe(needed);
  });

  it('needs none when the engine names the server, the match is not live, or this phone’s pick is shown', () => {
    const named: SetBasedServeContext = {
      servingSide: 'ent-home',
      side: 'home',
      serverPersonId: null,
      serveOrderKnown: true,
    };
    expect(needsAnchor(named, true, false)).toBe(false);
    expect(needsAnchor(unknown('undeclared'), false, false)).toBe(false);
    expect(needsAnchor(unknown('undeclared'), true, true)).toBe(false);
  });
});

describe('foldTableTennis: which queued taps are still legal', () => {
  // Expedite at 2–2 after four points: home serves next, so away is the receiver (ITTF 2.15.2: the receiver's 13th good
  // return is the receiver's point).
  const expedited: readonly Spec[] = [...played('HAHA'), expedite()];
  const returns = (wonBy: 'H' | 'A', count = 13) => rally({ wonBy, returns: count });

  it('keeps a 13 returns point for the receiver', () => {
    const result = folded(expedited, { queued: [queuedOf('k', returns('A'))] });
    expect(result.legalQueued).toEqual(['k']);
    expect(result.display.points).toEqual({ first: 2, second: 3 });
  });

  it('drops a returns rally that credits the server, and does not show it', () => {
    const result = folded(expedited, { queued: [queuedOf('k', returns('H'))] });
    expect(result.legalQueued).toEqual([]);
    expect(result.display.points).toEqual({ first: 2, second: 2 });
    expect(result.history.flatMap((group) => group.rows).some((row) => row.sending)).toBe(false);
  });

  // Review Focus 3: the phone was offline, a co-scorer's point landed and the server changed.
  it('drops a returns rally queued for a receiver who is the server now', () => {
    const ledger = [...expedited, rally({ wonBy: 'H' })]; // 3–2: under Expedite away serves the next point
    const queued = [queuedOf('k-stale', returns('A')), queuedOf('k-now', returns('H'))];
    expect(folded(ledger, { queued }).legalQueued).toEqual(['k-now']);
  });

  it('drops a returns rally while Expedite is not in force, as the pad would not have offered it', () => {
    const result = folded(played('HAHA'), { queued: [queuedOf('k', returns('A'))] });
    expect(result.legalQueued).toEqual([]);
  });

  it('takes a returns rally in the same queue after the Expedite that puts it in force, not before', () => {
    const after = [queuedOf('k-exp', expedite()), queuedOf('k-ret', returns('A'))];
    expect(folded(played('HAHA'), { queued: after }).legalQueued).toEqual(['k-exp', 'k-ret']);
    const before = [queuedOf('k-ret', returns('A')), queuedOf('k-exp', expedite())];
    expect(folded(played('HAHA'), { queued: before }).legalQueued).toEqual(['k-exp']);
  });

  it('drops a returns rally when the engine names no server', () => {
    const noAnchor: readonly Spec[] = [
      start(),
      rally({ wonBy: 'H' }),
      rally({ wonBy: 'A' }),
      expedite(),
    ];
    const result = folded(noAnchor, { queued: [queuedOf('k', returns('A'))] });
    expect(result.display).toMatchObject({ server: null, expedite: 'inForce' });
    expect(result.legalQueued).toEqual([]);
  });

  // Fix round 1, ruling 3: the Start pick is shown as the server, but only the engine's own naming counts for a returns
  // point. Nothing has anchored the pick yet (no point carries a `serving`), so the receiver is not known.
  it('drops a returns rally while the server is only this phone’s Start pick, not yet anchored', () => {
    const result = folded([start(), expedite()], {
      toss: 'first',
      queued: [queuedOf('k', returns('A'))],
    });
    expect(result.display).toMatchObject({
      server: 'first',
      serverPicked: true,
      expedite: 'inForce',
    });
    expect(result.legalQueued).toEqual([]);
    expect(result.display.points).toEqual({ first: 0, second: 0 });
  });

  it('leaves a rally with fewer than 13 returns to the engine: the server may win it', () => {
    const result = folded(expedited, { queued: [queuedOf('k', returns('H', 5))] });
    expect(result.legalQueued).toEqual(['k']);
  });

  it('leaves a returns rally that names its server to the engine, which refuses the wrong winner', () => {
    const wrong = rally({ wonBy: 'H', serving: 'H', returns: 13 });
    const right = rally({ wonBy: 'A', serving: 'H', returns: 13 });
    const queued = [queuedOf('k-wrong', wrong), queuedOf('k-right', right)];
    expect(folded(expedited, { queued }).legalQueued).toEqual(['k-right']);
  });

  it('takes a returns rally that names its own server even when the fold knows none', () => {
    const noAnchor: readonly Spec[] = [
      start(),
      rally({ wonBy: 'H' }),
      rally({ wonBy: 'A' }),
      expedite(),
    ];
    const named = rally({ wonBy: 'A', serving: 'H', returns: 13 });
    expect(folded(noAnchor, { queued: [queuedOf('k', named)] }).legalQueued).toEqual(['k']);
  });

  it('drops a second Expedite: it is in force to the end of the match, the engine takes it once', () => {
    const queued = [queuedOf('k-first', expedite()), queuedOf('k-second', expedite())];
    const result = folded(played('HA'), { queued });
    expect(result.legalQueued).toEqual(['k-first']);
    expect(
      folded([...played('HA'), expedite()], { queued: [queuedOf('k', expedite())] }).legalQueued,
    ).toEqual([]);
  });

  it('does not offer Undo for a tap it dropped', () => {
    const result = folded(expedited, { queued: [queuedOf('k', returns('H'))] });
    expect(result.legalQueued).toEqual([]);
    expect(result.display.undoable).toBe(false);
  });

  it('keeps judging the taps behind a dropped one, on the ledger without it', () => {
    const queued = [queuedOf('k-bad', returns('H')), queuedOf('k-next', rally({ wonBy: 'A' }))];
    const result = folded(expedited, { queued });
    expect(result.legalQueued).toEqual(['k-next']);
    expect(result.display.points).toEqual({ first: 2, second: 3 });
  });

  it('drops a queued rally once another scorer decided the match', () => {
    const result = folded(DECIDED_3_0, { queued: [queuedOf('k', rally({ wonBy: 'A' }))] });
    expect(result.legalQueued).toEqual([]);
    expect(result.display.points).toEqual({ first: 11, second: 0 });
  });

  it('drops a queued start another scorer already made, and keeps the point behind it', () => {
    const queued = [
      queuedOf('k-start', start()),
      queuedOf('k-rally', rally({ wonBy: 'A', serving: 'A' })),
    ];
    const result = folded([start()], { queued, toss: 'second' });
    expect(result.legalQueued).toEqual(['k-rally']);
    expect(result.display).toMatchObject({ points: { first: 0, second: 1 }, server: 'second' });
  });

  it('drops a queued undo of a tap another device already undid', () => {
    const ledger = [
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      { ...voiding(2), link: 'link-phone' },
    ];
    const queued = [queuedOf('k-undo', voiding(2)), queuedOf('k-next', rally({ wonBy: 'A' }))];
    expect(folded(ledger, { own: ['ev-2'], queued }).legalQueued).toEqual(['k-next']);
  });

  it('keeps every queued tap the match still takes, in order', () => {
    const queued = [
      queuedOf('k1', rally({ wonBy: 'A' })),
      queuedOf('k2', timeout('H')),
      queuedOf('k3', sanction('H', 'warning', 'p-sharma')),
    ];
    expect(folded(played('HA'), { queued }).legalQueued).toEqual(['k1', 'k2', 'k3']);
  });

  // Another rule set (the four questions): the organiser cut the games to 15 after a set score of 15–10 was recorded as
  // under way. The server judges only the new event strictly, so the ledger's own event stands and a point behind it is
  // legal.
  it('judges a queued tap alone strictly, not the ledger event before it that the edited rules would refuse', () => {
    const edited = withCfg(SINGLES, { setTo: 15, finalSetTo: 15 });
    const result = folded([start(), summary(15, 10)], {
      bootstrap: edited,
      queued: [queuedOf('k', rally({ wonBy: 'H' }))],
    });
    expect(result.legalQueued).toEqual(['k']);
  });
});

describe('foldTableTennis: cards, timeouts and the set score', () => {
  // The pad's two cards (the umpire's yellow and red) are the engine's two sanction levels; a level the engine adds is
  // unknown to `doneOf` and to `TableTennisSanctionLevel` until this fails.
  it('names exactly the engine’s sanction levels', () => {
    const named: Readonly<Record<TableTennisSanctionLevel, true>> = {
      warning: true,
      penalty: true,
    };
    expect([...tabletennisPadRules.sanctionLevels].sort()).toEqual(Object.keys(named).sort());
  });

  it('folds a card with no person named, and says it of the side', () => {
    const d = display([...played('HA'), sanction('A', 'penalty')]);
    expect(d.lastTap).toEqual({
      kind: 'sanction',
      side: 'second',
      level: 'penalty',
      person: 'L. Chen',
    });
  });

  it('folds a card for a named player, by the bootstrap’s name', () => {
    const d = display([...played('HA'), sanction('H', 'warning', 'p-iyer')], {
      bootstrap: DOUBLES,
    });
    expect(d.lastTap).toEqual({
      kind: 'sanction',
      side: 'first',
      level: 'warning',
      person: 'R. Iyer',
    });
  });

  it('records a timeout for each side, and says the last', () => {
    const d = display([...played('HA'), timeout('H'), timeout('A')]);
    expect(d.lastTap).toEqual({ kind: 'timeout', side: 'second' });
  });

  it('sets a game whole before its first point: it is a box, the next game is next', () => {
    const d = display([start(), wholeGame(11, 7)]);
    expect(d).toMatchObject({
      phase: 'betweenGames',
      game: 2,
      finished: [{ points: { first: 11, second: 7 }, winner: 'first' }],
      lastTap: { kind: 'setScore', first: 11, second: 7 },
    });
  });

  it('names no server after a game was set whole, and asks who is serving until a point names one', () => {
    const d = display([start(), wholeGame(11, 7)]);
    expect(d).toMatchObject({ server: null, serverPicked: false, anchorNeeded: true });
  });
});

describe('foldTableTennis: a variant', () => {
  const hardbat = withCfg(SINGLES, { setTo: 21, finalSetTo: 21 });

  it('reads the hardbat game to 21 from the config: deuce at 20–20, not 10–10', () => {
    expect(display(DEUCE_10_10, { bootstrap: hardbat })).toMatchObject({
      points: { first: 10, second: 10 },
      deuce: false,
      rules: { bestOf: 5, setTo: 21, finalSetTo: 21, winBy: 2, scoreBound: 41 }, // 21 + the engine's margin of 20
    });
    const twenty = played(`H${'AH'.repeat(19)}A`); // 20–20 after 40 points
    expect(display(twenty, { bootstrap: hardbat })).toMatchObject({
      points: { first: 20, second: 20 },
      deuce: true,
      server: 'first',
      serveNumber: 1,
    });
  });

  it('reads the deciding game’s own target from finalSetTo', () => {
    const shorter = withCfg(SINGLES, { setTo: 11, finalSetTo: 7 });
    expect(display([], { bootstrap: shorter }).rules).toEqual({
      ...STANDARD_RULES,
      finalSetTo: 7,
    });
  });

  it('reads a best of 7 from the config', () => {
    const bo7 = withCfg(SINGLES, { bestOf: 7 });
    expect(display([], { bootstrap: bo7 }).rules).toEqual({ ...STANDARD_RULES, bestOf: 7 });
  });
});

describe('foldTableTennis: the match, decided', () => {
  it('decides a best of 5 at three games, keeping the last game’s points and naming no server', () => {
    const d = display(DECIDED_3_0);
    expect(d).toMatchObject({
      phase: 'decided',
      game: 3,
      points: { first: 11, second: 0 },
      server: null,
      serveNumber: null,
      expedite: 'off',
      deuce: false,
    });
    expect(d.finished).toEqual([
      { points: { first: 11, second: 0 }, winner: 'first' },
      { points: { first: 11, second: 0 }, winner: 'first' },
      { points: { first: 11, second: 0 }, winner: 'first' },
    ]);
  });
});

describe('foldTableTennis: the last tap, and Undo', () => {
  const taken = [start(), rally({ wonBy: 'H', serving: 'H' }), rally({ wonBy: 'A' })];

  it('says the last tap was undone when the void is the latest event', () => {
    const d = display([...taken, voiding(3)]);
    expect(d.lastTap).toEqual({
      kind: 'undone',
      tap: { kind: 'rally', side: 'second', won: 'none', game: 1 },
    });
    expect(d.points).toEqual({ first: 1, second: 0 });
  });

  it('says a 13 returns point undone as that, and a card undone as that', () => {
    const exp = [...played('HAHA'), expedite()];
    const returned = display([...exp, rally({ wonBy: 'A', returns: 13 }), voiding(7)]);
    expect(returned.lastTap).toMatchObject({
      kind: 'undone',
      tap: { kind: 'returns', returns: 13 },
    });
    const carded = display([...taken, sanction('H', 'warning'), voiding(4)]);
    expect(carded.lastTap).toMatchObject({
      kind: 'undone',
      tap: { kind: 'sanction', level: 'warning' },
    });
  });

  it('shows this phone’s queued undo at once: the point taken back, the score as it was', () => {
    const d = display(taken, { own: ['ev-3'], queued: [queuedOf('k-undo', voiding(3))] });
    expect(d.points).toEqual({ first: 1, second: 0 });
    expect(d.lastTap).toMatchObject({ kind: 'undone', tap: { kind: 'rally', side: 'second' } });
  });

  it('returns to the Start screen when the start is undone, with no line and nothing to undo', () => {
    const d = display([start(), voiding(1)]);
    expect(d).toMatchObject({ phase: 'notStarted', lastTap: null, undoable: false });
  });

  it('names no tap for the start', () => {
    expect(undoneTap({ kind: 'start', server: 'first' })).toBeNull();
    const point = { kind: 'rally', side: 'first', won: 'none', game: 1 } as const;
    expect(undoneTap(point)).toEqual(point);
    expect(undoneTap({ kind: 'expedite' })).toEqual({ kind: 'expedite' });
  });
});

// Fix round 1: a `serving` stamp is valid only at the score it was made at, so the display counts the score events in the
// scorer's view (the ledger and this phone's legal queued taps): each standing point and each standing game score. The
// tap's `base` is this count (`tableTennisEventFor`), and its send compares it with the ledger's.
describe('foldTableTennis: the count of score events', () => {
  it('counts each standing point, the start and the first point included', () => {
    expect(display(played('HAH')).scoreEvents).toBe(3);
    expect(display(GAME_ONE_11_7).scoreEvents).toBe(18);
  });

  it('counts a game score alike, partial or whole, and across games', () => {
    expect(display([start(), summary(3, 2)]).scoreEvents).toBe(1);
    expect(display([start(), wholeGame(11, 7), rally({ wonBy: 'H' })]).scoreEvents).toBe(2);
    expect(display(DECIDED_3_0).scoreEvents).toBe(33);
  });

  it('counts nothing a scorer records but a point and a game score', () => {
    const quiet = [start(), timeout('H'), expedite(), sanction('A', 'warning', 'p-chen')];
    expect(display(quiet).scoreEvents).toBe(0);
  });

  it('does not count a point that was undone, nor the undo itself', () => {
    expect(
      display([start(), rally({ wonBy: 'H' }), rally({ wonBy: 'A' }), voiding(3)]).scoreEvents,
    ).toBe(1);
  });

  it('counts this phone’s legal queued taps on top of the ledger', () => {
    const ledger = [start(), rally({ wonBy: 'H', serving: 'H' })];
    const queued = [queuedOf('k1', rally({ wonBy: 'A' })), queuedOf('k2', summary(2, 1))];
    expect(display(ledger, { queued }).scoreEvents).toBe(3);
  });

  it('counts a queued undo as the point it takes back', () => {
    const ledger = [start(), rally({ wonBy: 'H', serving: 'H' })];
    expect(display(ledger, { queued: [queuedOf('k1', voiding(2))] }).scoreEvents).toBe(0);
  });

  // A tap the match no longer takes is not in the view the scorer had.
  it('does not count a queued tap the match refuses', () => {
    const ledger = played('HA');
    const refused = queuedOf('k1', rally({ wonBy: 'A', returns: 13 }));
    expect(folded(ledger, { queued: [refused] }).legalQueued).toEqual([]);
    expect(display(ledger, { queued: [refused] }).scoreEvents).toBe(2);
  });
});

describe('foldTableTennis: Undo is offered', () => {
  it('on this phone’s last event, and not once another scorer’s point stands after it', () => {
    const ledger = [start(), rally({ wonBy: 'H', serving: 'H' }), rally({ wonBy: 'A' })];
    expect(display(ledger, { own: ['ev-2', 'ev-3'] }).undoable).toBe(true);
    expect(display(ledger, { own: ['ev-2'] }).undoable).toBe(false);
    expect(
      display(ledger, { own: ['ev-2'], queued: [queuedOf('k', rally({ wonBy: 'H' }))] }).undoable,
    ).toBe(true);
  });
});

describe('foldTableTennis: when it cannot fold', () => {
  it('says the config, for a cfg the engine’s schema refuses', () => {
    expect(fold([], { bootstrap: withCfg(SINGLES, 'garbled') })).toEqual({
      kind: 'unfoldable',
      reason: 'cfg',
    });
  });

  it('says the sides, for a seat with no entrant yet', () => {
    const waiting: Bootstrap = { ...SINGLES, sides: { ...SINGLES.sides, away: null } };
    expect(fold([], { bootstrap: waiting })).toEqual({ kind: 'unfoldable', reason: 'sides' });
  });

  it('says the ledger, for one the engine will not replay', () => {
    expect(fold([rally({ wonBy: 'H' })])).toEqual({ kind: 'unfoldable', reason: 'ledger' });
  });
});

describe('foldTableTennis: a second call', () => {
  it('answers the same for the same input, and changes none of it', () => {
    const ledger = Object.freeze(ledgerOf([...GAME_ONE_11_7, sanction('A', 'warning')]));
    const queued = Object.freeze([queuedOf('k', rally({ wonBy: 'A' }))]);
    const input: SportFoldInput = Object.freeze({
      bootstrap: SINGLES,
      ledger,
      queued,
      ownEventIds: Object.freeze(['ev-2']),
      toss: null,
    });
    const before = JSON.stringify(input);
    expect(foldTableTennis(input)).toEqual(foldTableTennis(input));
    expect(JSON.stringify(input)).toBe(before);
  });
});
