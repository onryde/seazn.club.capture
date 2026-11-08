import { cricket } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { foldCricket, KEEPER_POSITION, KEEPER_ROLE } from '@/domain/scoring/cricketFold';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  AWAY_BOWLERS,
  DOT,
  FIRST_INNINGS_8,
  FOUR,
  HOME,
  HOME_BOWLERS,
  LEAGUE_2,
  MATCH,
  NO_AWAY_PLAYERS,
  NO_BALL,
  ONE,
  OPENING,
  OVER_ONE_DONE,
  T20,
  T20_LONG,
  TIED_KO,
  TWO_INNINGS,
  WIDE,
  ball,
  eventId,
  inningsOf,
  ledgerOf,
  player,
  queuedOf,
  summary,
  superOverOf,
  toss,
  voiding,
  withCfg,
  type BallSpec,
  type Spec,
} from '../../../test/cricketLedger';

// A cricket match on the pad (S2-4 spec §4 to §6; plan Task 5): the server's ledger with this phone's queued taps on top,
// folded through the engine's cricket module, with the scorer's pending picks read in. Every expected value is written out
// from the spec and the Laws, never computed by the fold. H is the home side (first), A the away side (second).

type Over = {
  readonly bootstrap?: Bootstrap;
  readonly picks?: PendingPicks;
  readonly queued?: readonly QueuedEvent[];
  readonly own?: readonly number[];
};

function foldOf(specs: readonly Spec[], over: Over = {}) {
  return foldCricket({
    bootstrap: over.bootstrap ?? MATCH,
    ledger: ledgerOf(specs),
    queued: over.queued ?? [],
    ownEventIds: (over.own ?? []).map(eventId),
    toss: null,
    picks: over.picks ?? NO_PICKS,
  });
}

function displayOf(specs: readonly Spec[], over: Over = {}) {
  const folded = foldOf(specs, over);
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

const H = (n: number) => player('H', n);
const A = (n: number) => player('A', n);

/** A delivery of the first over (over 0), the openers at the crease as they open, `A-p11` bowling. */
const firstOver = (ballInOver: number, more: Partial<BallSpec> = {}) =>
  ball({ over: 0, ballInOver, striker: H(1), nonStriker: H(2), bowler: A(11), ...more });

const batter = (id: string, name: string, runs: number, balls: number) => ({
  id,
  name,
  runs,
  balls,
});

/** The home side's eleven in the team sheet's order. */
const HOME_ORDER = Array.from({ length: 11 }, (_, i) => H(i + 1));

const OPENERS_I1 = { 'openers.i1': [H(1), H(2)] };

describe('the stage', () => {
  it('before the toss the stage is toss; after it, setup', () => {
    const before = displayOf([]);
    expect(before).toMatchObject({
      stage: 'toss',
      toss: null,
      innings: null,
      crease: null,
      needs: null,
    });
    const after = displayOf([toss('H', 'bat')]);
    expect(after.stage).toBe('setup');
    expect(after.toss).toStrictEqual({ wonBy: 'first', elected: 'bat' });
    expect(after.innings).toStrictEqual({
      ordinal: 'i1',
      superOver: false,
      batting: 'first',
      runs: 0,
      wickets: 0,
      legalBalls: 0,
      ballsLimit: 12,
      chase: null,
    });
    expect(after.needs).toBe('openers');
  });

  it('the toss decides who bats first: the winner who bats, or the other side when the winner bowls', () => {
    expect(displayOf([toss('A', 'bat')]).innings?.batting).toBe('second');
    expect(displayOf([toss('H', 'bowl')]).innings?.batting).toBe('second');
    expect(displayOf([toss('A', 'bowl')]).innings?.batting).toBe('first');
  });

  it('is live once started, and not decided', () => {
    const display = displayOf(OPENING, { picks: OPENERS_I1 });
    expect(display.stage).toBe('live');
    expect(display.result).toBeNull();
  });

  it('a side with no players is totals', () => {
    const display = displayOf(OPENING, { bootstrap: NO_AWAY_PLAYERS });
    expect(display.stage).toBe('totals');
    expect(display.needs).toBeNull();
    expect(display.entered).toStrictEqual({ first: true, second: false });
  });

  it('an innings scored in over totals stays totals until the next innings', () => {
    expect(displayOf([...OPENING, summary(4, 0, 6)]).stage).toBe('totals');
    const next = displayOf([...OPENING, summary(4, 0, 6), summary(8, 0, 12)]);
    expect(next.stage).toBe('break');
    expect(next.innings?.ordinal).toBe('i2');
    expect(next.needs).toBe('openers');
  });

  // Ruling 74: a tie in totals goes to a super over nobody can bat in. Under LEAGUE_2 a tie is the result (preflight T17).
  it('a tie in totals mode is tiedNoPlayers', () => {
    const tie = [...OPENING, summary(8, 0, 12), summary(8, 1, 12)];
    expect(displayOf(tie, { bootstrap: NO_AWAY_PLAYERS }).stage).toBe('tiedNoPlayers');
    const league = displayOf(tie, { bootstrap: withCfg(NO_AWAY_PLAYERS, LEAGUE_2) });
    expect(league.stage).toBe('decided');
    expect(league.result).toStrictEqual({ margin: { kind: 'tie' }, winner: null });
  });

  // Law 14 and Law 16: 300 against 50 and, following on, 50 again is a win by an innings and 200 runs. No fourth innings
  // is due, though the engine's batting order would name one.
  it('an innings win leaves the third innings the last, with no fourth due', () => {
    const innings = [summary(300, 10, 300), summary(50, 10, 120), followOn, summary(50, 10, 120)];
    const display = displayOf([...OPENING, ...innings], { bootstrap: withCfg(MATCH, TWO_INNINGS) });
    expect(display.stage).toBe('decided');
    expect(display.result).toStrictEqual({
      margin: { kind: 'innings_and_runs', value: 200 },
      winner: 'first',
    });
    expect(display.innings).toMatchObject({
      ordinal: 'i3',
      batting: 'second',
      runs: 50,
      wickets: 10,
    });
  });

  it('a decided match is decided, with the engine margin and the winner by the seat', () => {
    const display = displayOf(T20_LONG, { bootstrap: withCfg(MATCH, T20) });
    expect(display.stage).toBe('decided');
    expect(display.result).toStrictEqual({ margin: { kind: 'runs', value: 122 }, winner: 'first' });
    expect(display.needs).toBeNull();
    expect(display.innings).toMatchObject({
      ordinal: 'i2',
      runs: 18,
      legalBalls: 120,
      chase: null,
    });
  });
});

describe('the crease', () => {
  it('the openers’ pick is the crease before the first ball', () => {
    const display = displayOf(OPENING, { picks: { 'openers.i1': [H(3), H(1)] } });
    expect(display.crease).toStrictEqual({
      striker: batter(H(3), 'Home Player 3', 0, 0),
      nonStriker: batter(H(1), 'Home Player 1', 0, 0),
    });
    expect(display.needs).toBe('bowler');
    expect(display.bowler).toBeNull();
    const ready = displayOf(OPENING, {
      picks: { 'openers.i1': [H(3), H(1)], 'bowler.i1.0': [A(11)] },
    });
    expect(ready.bowler).toStrictEqual({ id: A(11), name: 'Away Player 11', figures: '0-0-0-0' });
    expect(ready.needs).toBeNull();
    expect(ready.stage).toBe('live');
  });

  // §4.2: the engine's simplification, a wicket ball never moves the strike, so a run out's completed run does not.
  it('odd runs swap the strike; a wicket ball never does', () => {
    const single = [...OPENING, firstOver(1, { bat: 1 })];
    expect(displayOf(single).crease).toStrictEqual({
      striker: batter(H(2), 'Home Player 2', 0, 0),
      nonStriker: batter(H(1), 'Home Player 1', 1, 1),
    });
    const runOut = ball({
      over: 0,
      ballInOver: 2,
      striker: H(2),
      nonStriker: H(1),
      bowler: A(11),
      bat: 1,
      wicket: { kind: 'runout', out: H(1), fielder: A(3), incoming: H(3), bowlerCredited: false },
    });
    expect(displayOf([...single, runOut]).crease).toStrictEqual({
      striker: batter(H(2), 'Home Player 2', 1, 1),
      nonStriker: batter(H(3), 'Home Player 3', 0, 0),
    });
  });

  it('a no-ball makes the next ball a free hit', () => {
    const noBall = [...OPENING, firstOver(1, { extras: { kind: 'noball', runs: 1 } })];
    expect(displayOf(noBall).freeHit).toBe(true);
    expect(displayOf([...noBall, firstOver(1)]).freeHit).toBe(false);
    expect(displayOf([...OPENING, firstOver(1)]).freeHit).toBe(false);
  });

  it('a reordered yet-to-bat order is the display’s order', () => {
    const display = displayOf(OPENING, { picks: { 'order.first': [H(1), H(2), H(5), H(4)] } });
    expect(display.battingOrder).toStrictEqual([
      H(1),
      H(2),
      H(5),
      H(4),
      H(3),
      H(6),
      H(7),
      H(8),
      H(9),
      H(10),
      H(11),
    ]);
  });

  it('with no order picked the order is the team sheet’s', () => {
    expect(displayOf(OPENING).battingOrder).toStrictEqual(HOME_ORDER);
  });

  // Preflight F6: a hand swap is held as the pair the next ball carries, keyed to that ball.
  it('a standing swap pick is the display’s crease, reversed', () => {
    const dot = [...OPENING, firstOver(1)];
    const swapped = displayOf(dot, { picks: { 'swap.i1.1': [H(2), H(1)] } }).crease;
    expect([swapped?.striker.id, swapped?.nonStriker.id]).toStrictEqual([H(2), H(1)]);
    const otherPair = displayOf(dot, { picks: { 'swap.i1.1': [H(3), H(1)] } }).crease;
    expect([otherPair?.striker.id, otherPair?.nonStriker.id]).toStrictEqual([H(1), H(2)]);
    const pastBall = displayOf(dot, { picks: { 'swap.i1.0': [H(2), H(1)] } }).crease;
    expect([pastBall?.striker.id, pastBall?.nonStriker.id]).toStrictEqual([H(1), H(2)]);
  });

  it('a pick naming a person no longer in the lineup is ignored', () => {
    const bench = displayOf(OPENING, { picks: { 'openers.i1': [H(1), H(12)] } });
    expect(bench.crease).toBeNull();
    expect(bench.needs).toBe('openers');
    const gone = displayOf(OPENING, { picks: { ...OPENERS_I1, 'bowler.i1.0': ['A-gone'] } });
    expect(gone.needs).toBe('bowler');
    expect(gone.bowler).toBeNull();
    const order = displayOf(OPENING, { picks: { 'order.first': ['H-gone', H(3)] } });
    expect(order.battingOrder.slice(0, 3)).toStrictEqual([H(3), H(1), H(2)]);
    expect(order.battingOrder).toHaveLength(11);
  });

  it('a bootstrap with no order_no at all gives the batting order in its row order', () => {
    const rows = [3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => ({
      personId: H(n),
      pairOrder: null,
      slot: 'starting' as const,
    }));
    const bootstrap = { ...MATCH, sides: { ...MATCH.sides, home: { ...HOME, lineup: rows } } };
    const display = displayOf([toss('H', 'bat')], { bootstrap });
    const expected = [H(3), H(1), H(2), H(4), H(5), H(6), H(7), H(8), H(9), H(10), H(11)];
    expect(display.battingOrder).toStrictEqual(expected);
    expect(display.players.first.map((one) => one.id)).toStrictEqual(expected);
  });

  it('names the team sheet’s keeper, by the role the engine’s catalog names', () => {
    const display = displayOf([]);
    expect(display.players.first.filter((one) => one.keeper).map((one) => one.id)).toStrictEqual([
      H(2),
    ]);
    expect(display.players.second.map((one) => one.name)[0]).toBe('Away Player 1');
    expect(cricket.positions?.roles?.map((role) => role.key)).toContain(KEEPER_ROLE);
    expect(cricket.positions?.groups.map((group) => group.key)).toContain(KEEPER_POSITION);
  });

  it('names the keeper by the WK position when the sheet gives no role', () => {
    const lineup = HOME.lineup.map(({ roles: _roles, ...row }) =>
      row.personId === H(5) ? { ...row, positionKey: KEEPER_POSITION } : row,
    );
    const bootstrap = { ...MATCH, sides: { ...MATCH.sides, home: { ...HOME, lineup } } };
    const keepers = displayOf([], { bootstrap }).players.first.filter((one) => one.keeper);
    expect(keepers.map((one) => one.id)).toStrictEqual([H(5)]);
  });
});

describe('the bowler and the over', () => {
  // A dot, a single, a four, a wide, a no-ball, then a run out on the free hit (a free hit allows a run out).
  it('the over strip reads ·, 1, 4, wd, nb, W', () => {
    const script = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, [DOT, ONE, FOUR, WIDE, NO_BALL])];
    const runOut = ball({
      over: 0,
      ballInOver: 4,
      striker: H(2),
      nonStriker: H(1),
      bowler: A(11),
      wicket: { kind: 'runout', out: H(2), fielder: A(4), incoming: H(3), bowlerCredited: false },
    });
    const { over } = displayOf([...script, runOut]);
    expect(over.number).toBe(1);
    expect(over.chips).toStrictEqual([
      { text: '·', tone: 'dot' },
      { text: '1', tone: 'run' },
      { text: '4', tone: 'boundary' },
      { text: 'wd', tone: 'extra' },
      { text: 'nb', tone: 'extra' },
      { text: 'W', tone: 'wicket' },
    ]);
  });

  it('an extra’s chip carries the runs that came off the ball; an all-run four is no boundary', () => {
    const balls = [
      firstOver(1, { extras: { kind: 'wide', runs: 3 } }),
      firstOver(1, { extras: { kind: 'bye', runs: 2 } }),
      firstOver(2, { extras: { kind: 'legbye', runs: 1 }, striker: H(1), nonStriker: H(2) }),
      firstOver(3, { bat: 4, striker: H(2), nonStriker: H(1) }),
    ];
    expect(displayOf([...OPENING, ...balls]).over.chips).toStrictEqual([
      { text: '3wd', tone: 'extra' },
      { text: '2b', tone: 'extra' },
      { text: 'lb', tone: 'extra' },
      { text: '4', tone: 'run' },
    ]);
  });

  it('an over’s end needs a bowler unless one is picked for that over', () => {
    const ended = displayOf(OVER_ONE_DONE);
    expect(ended.needs).toBe('bowler');
    expect(ended.bowler).toBeNull();
    expect(ended.over).toStrictEqual({ number: 2, chips: [] });
    expect(ended.crease).toStrictEqual({
      striker: batter(H(2), 'Home Player 2', 3, 3),
      nonStriker: batter(H(1), 'Home Player 1', 3, 3),
    });
    const picked = displayOf(OVER_ONE_DONE, { picks: { 'bowler.i1.1': [A(10)] } });
    expect(picked.needs).toBeNull();
    expect(picked.bowler).toStrictEqual({ id: A(10), name: 'Away Player 10', figures: '0-0-0-0' });
  });

  it('a pick of the last over’s bowler is not the next over’s', () => {
    expect(displayOf(OVER_ONE_DONE, { picks: { 'bowler.i1.1': [A(11)] } }).needs).toBe('bowler');
  });

  it('a stale bowler pick for a past over is ignored', () => {
    const display = displayOf(OVER_ONE_DONE, { picks: { 'bowler.i1.0': [A(10)] } });
    expect(display.needs).toBe('bowler');
    expect(display.bowler).toBeNull();
  });

  // Review Focus 2: the pick is keyed to the over, so Undo of its first ball brings it back, not the last over's bowler.
  it('undoing the over’s first ball shows the picked bowler again', () => {
    const first = ball({ over: 1, ballInOver: 1, striker: H(2), nonStriker: H(1), bowler: A(10) });
    const picks = { 'bowler.i1.1': [A(10)] };
    const bowled = displayOf([...OVER_ONE_DONE, first], { picks, own: [9] });
    expect(bowled.bowler).toStrictEqual({
      id: A(10),
      name: 'Away Player 10',
      figures: '0.1-0-0-0',
    });
    const undone = displayOf([...OVER_ONE_DONE, first, voiding(9)], { picks, own: [9, 10] });
    expect(undone.bowler).toStrictEqual({ id: A(10), name: 'Away Player 10', figures: '0-0-0-0' });
    expect(undone.needs).toBeNull();
    expect(undone.over).toStrictEqual({ number: 2, chips: [] });
    expect(undone.lastTap).toStrictEqual({
      kind: 'undone',
      tap: { kind: 'ball', ball: { bat: 0, extra: null, boundary: null, wicket: null } },
    });
  });

  it('mid-over the bowler is the fold’s, whatever is picked', () => {
    const display = displayOf([...OPENING, firstOver(1)], { picks: { 'bowler.i1.0': [A(9)] } });
    expect(display.bowler?.id).toBe(A(11));
  });

  it('figures read O-M-R-W off the scorecard', () => {
    const twoBalls = [
      ...OPENING,
      firstOver(1, { bat: 1 }),
      firstOver(2, { bat: 4, boundary: 4, striker: H(2), nonStriker: H(1) }),
    ];
    expect(displayOf(twoBalls).bowler?.figures).toBe('0.2-0-5-0');
    const t20 = withCfg(MATCH, T20);
    const maiden = inningsOf(
      'H',
      [A(11), A(10), A(11)],
      Array.from({ length: 13 }, () => DOT),
    );
    expect(displayOf([...OPENING, ...maiden], { bootstrap: t20 }).bowler?.figures).toBe(
      '1.1-1-0-0',
    );
  });
});

describe('the chase and the super over', () => {
  // KO_2: the first innings 8/0 off two overs, so the reply needs 9 off 12 (preflight D7: the ledger stated).
  it('the chase reads need 9 off 12 balls before its first ball', () => {
    const display = displayOf(FIRST_INNINGS_8);
    expect(display.stage).toBe('break');
    expect(display.innings).toStrictEqual({
      ordinal: 'i2',
      superOver: false,
      batting: 'second',
      runs: 0,
      wickets: 0,
      legalBalls: 0,
      ballsLimit: 12,
      chase: { need: 9, balls: 12, target: 9 },
    });
  });

  it('after a maiden it reads need 9 off 6 balls', () => {
    const maiden = inningsOf(
      'A',
      HOME_BOWLERS,
      Array.from({ length: 6 }, () => DOT),
    );
    const display = displayOf([...FIRST_INNINGS_8, ...maiden]);
    expect(display.innings?.chase).toStrictEqual({ need: 9, balls: 6, target: 9 });
    expect(display.stage).toBe('live');
  });

  it('the break ends once the next innings has its openers and its bowler', () => {
    const picks = { 'openers.i2': [A(1), A(2)], 'bowler.i2.0': [H(11)] };
    const display = displayOf(FIRST_INNINGS_8, { picks });
    expect(display.stage).toBe('live');
    expect(display.needs).toBeNull();
    expect(display.crease?.striker.id).toBe(A(1));
    expect(display.battingOrder[0]).toBe(A(1));
  });

  it('a knockout tie waits on the super over’s setup, the side that batted second batting first', () => {
    const display = displayOf(TIED_KO);
    expect(display.stage).toBe('superOverSetup');
    expect(display.innings).toMatchObject({
      ordinal: 's1',
      superOver: true,
      batting: 'second',
      chase: null,
    });
    expect(display.innings?.ballsLimit).toBe(6);
  });

  // F17: the engine decides a super over privately, so the target is the Laws' (one more than the first innings).
  it('a super over of 7 sets a target of 8', () => {
    const seven = superOverOf('A', H(11), [FOUR, ONE, ONE, ONE, DOT, DOT]);
    const display = displayOf([...TIED_KO, ...seven]);
    expect(display.stage).toBe('superOverSetup');
    expect(display.innings).toStrictEqual({
      ordinal: 's2',
      superOver: true,
      batting: 'first',
      runs: 0,
      wickets: 0,
      legalBalls: 0,
      ballsLimit: 6,
      chase: { need: 8, balls: 6, target: 8 },
    });
  });

  it('a super over’s empty end takes the replacement picked', () => {
    const out = superOverOf('A', H(11), [{ out: true }]);
    const none = displayOf([...TIED_KO, ...out]);
    expect(none.crease).toBeNull();
    const picked = displayOf([...TIED_KO, ...out], { picks: { 'incoming.s1': [A(3)] } });
    expect([picked.crease?.striker.id, picked.crease?.nonStriker.id]).toStrictEqual([A(3), A(2)]);
    expect(picked.over.chips).toStrictEqual([{ text: 'W', tone: 'wicket' }]);
    expect(picked.bowler).toStrictEqual({
      id: H(11),
      name: 'Home Player 11',
      figures: '0.1-0-0-1',
    });
    const dismissed = displayOf([...TIED_KO, ...out], { picks: { 'incoming.s1': [A(1)] } });
    expect(dismissed.crease).toBeNull();
  });
});

describe('a super over takes no hand swap (ruling 84)', () => {
  it('a reversed pair picked in a super over is ignored', () => {
    const dot = [...TIED_KO, ...superOverOf('A', H(11), [DOT])];
    const display = displayOf(dot, { picks: { 'swap.s1.1': [A(2), A(1)] } });
    expect([display.crease?.striker.id, display.crease?.nonStriker.id]).toStrictEqual([A(1), A(2)]);
  });
});

describe('legalQueued', () => {
  // Review Focus 1: a co-scorer recorded the ball first; the phone's copy is a different delivery, never restamped.
  it('legalQueued drops a ball whose ballInOver the ledger already holds', () => {
    const ledger = [...OPENING, firstOver(1), firstOver(2)];
    const queued = [queuedOf('q-stale', firstOver(2)), queuedOf('q-next', firstOver(3))];
    const folded = foldOf(ledger, { queued });
    if (folded.kind !== 'folded') throw new Error('did not fold');
    expect(folded.legalQueued).toStrictEqual(['q-next']);
    expect(folded.display.innings?.legalBalls).toBe(3);
  });

  it('drops an Undo of a ball another Undo already took back', () => {
    const ledger = [...OPENING, firstOver(1), voiding(3)];
    const folded = foldOf(ledger, { own: [3, 4], queued: [queuedOf('q-again', voiding(3))] });
    expect(folded.kind === 'folded' ? folded.legalQueued : null).toStrictEqual([]);
  });

  it('takes every queued tap the match takes, in order', () => {
    const queued = [queuedOf('q-1', firstOver(1)), queuedOf('q-2', firstOver(2))];
    const folded = foldOf(OPENING, { queued });
    expect(folded.kind === 'folded' ? folded.legalQueued : null).toStrictEqual(['q-1', 'q-2']);
  });
});

const followOn: Spec = { type: 'cricket.followon', payload: {} };

describe('Undo and the last tap', () => {
  it('an undone toss shows no last-tap line', () => {
    const display = displayOf([toss('H', 'bat'), voiding(1)], { own: [1, 2] });
    expect(display.stage).toBe('toss');
    expect(display.lastTap).toBeNull();
  });

  it('this phone’s own ball is undoable and is the last tap; another scorer’s is not undoable', () => {
    const own = displayOf([...OPENING, firstOver(1, { bat: 4, boundary: 4 })], { own: [3] });
    expect(own.undoable).toBe(true);
    expect(own.lastTap).toStrictEqual({
      kind: 'ball',
      ball: { bat: 4, extra: null, boundary: 4, wicket: null },
    });
    expect(displayOf([...OPENING, firstOver(1)]).undoable).toBe(false);
  });
});

describe('unfoldable', () => {
  it('a seat with no entrant, or a config the engine refuses', () => {
    expect(
      foldOf([], { bootstrap: { ...MATCH, sides: { home: HOME, away: null } } }),
    ).toStrictEqual({
      kind: 'unfoldable',
      reason: 'sides',
    });
    expect(foldOf([], { bootstrap: withCfg(MATCH, { ballsPerInnings: 12 }) })).toStrictEqual({
      kind: 'unfoldable',
      reason: 'cfg',
    });
  });
});
