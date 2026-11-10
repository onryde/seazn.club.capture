import { describe, expect, it } from 'vitest';
import { cricketMatchOf, cricketRefusalOf } from '@/domain/scoring/cricketEngine';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { cricketMoreItems } from '@/domain/scoring/cricketMore';
import { cricketBoard, cricketBreakCard, cricketPad } from '@/domain/scoring/cricketPad';
import { orderMoved, setupStep, setupView } from '@/domain/scoring/cricketSetup';
import { NO_PICKS, type PendingPicks } from '@/domain/scoring/pendingPicks';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import {
  ALL_OUT_FIRST,
  AWAY_BOWLERS,
  DOT,
  FIRST_INNINGS_8,
  FOUR,
  HOME_BOWLERS,
  KO_2,
  LEAGUE_2,
  MATCH,
  NO_AWAY_PLAYERS,
  ONE,
  OPENING,
  OUT,
  TIED_KO,
  TWO,
  TWO_INNINGS,
  TWO_SUPER_OVERS_TIED,
  ball,
  declare,
  eventId,
  inningsOf,
  ledgerOf,
  player,
  retire,
  start,
  summary,
  superOverOf,
  times,
  toss,
  voiding,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';

// The innings break, the super over and the result (S2-4 spec §4.5 to §4.7; plan Task 16), read off the fold as the
// break's card and setup show them. H is the home side ("Home CC", first), A the away side ("Away CC", second). Every
// expected string is written out from the dictionaries and the Laws, never computed by the code under test.

function displayOf(specs: readonly Spec[], picks: PendingPicks = NO_PICKS, bootstrap = MATCH) {
  const folded = foldCricket({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
    picks,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

const H = (n: number) => player('H', n);
const A = (n: number) => player('A', n);
const en = createTranslator('en');

/** The break card in English: its title and its line, or null when no break stands. */
function cardOf(specs: readonly Spec[], picks: PendingPicks = NO_PICKS, bootstrap = MATCH) {
  const card = cricketBreakCard(displayOf(specs, picks, bootstrap));
  if (card === null) return null;
  return {
    title: translatePad(en, card.title),
    line: card.line === null ? null : translatePad(en, card.line),
  };
}

/**
 * A super over of 7/1 each after the knockout's tie: the away side hit the only four; the home side's second, H-p2, is
 * out off the last ball.
 */
const SUPER_OVER_TIED: readonly Spec[] = [
  ...TIED_KO,
  ...superOverOf('A', H(11), [FOUR, ONE, ONE, DOT, ONE, OUT]),
  ...superOverOf('H', A(11), [ONE, ONE, ONE, TWO, TWO, OUT]),
];

/**
 * The away side needs 9 off 12; six down in the first over, then 4, 4 and 1: 9/6, so it wins with four wickets in hand
 * (eleven a side, ten wickets an innings).
 */
const WON_BY_4: readonly Spec[] = [
  ...FIRST_INNINGS_8,
  ...inningsOf('A', HOME_BOWLERS, [...times(6, OUT), FOUR, FOUR, ONE]),
];

const HOME_ELEVEN = Array.from({ length: 11 }, (_, i) => H(i + 1));
const AWAY_ELEVEN = Array.from({ length: 11 }, (_, i) => A(i + 1));

describe('the innings break (spec §4.5)', () => {
  // KO_2: the home side 8/0 off two overs, so the away side needs 9 off 12 balls before it has faced one. The web shows
  // the target only after the chase's first ball; the phone shows it on the break card.
  it('the break card shows the target before the chase’s first ball', () => {
    expect(cardOf(FIRST_INNINGS_8)).toStrictEqual({
      title: 'Innings break',
      line: 'Home CC 8/0 (2 ov) · Away CC need 9 off 12 balls',
    });
    const nl = cricketBreakCard(displayOf(FIRST_INNINGS_8));
    expect(
      nl?.line === null || nl === null ? null : translatePad(createTranslator('nl'), nl.line),
    ).toBe('Home CC 8/0 (2 ov) · Away CC heeft 9 nodig uit 12 ballen');
  });

  it('stands while the next innings waits on its openers, its bowler or Start innings, and goes with the first ball', () => {
    const picked = { 'openers.i2': [A(1), A(2)], 'bowler.i2.0': [H(11)] };
    expect(cardOf(FIRST_INNINGS_8, picked)?.title).toBe('Innings break');
    expect(cardOf(FIRST_INNINGS_8, { ...picked, 'begin.i2': ['second'] })).toBeNull();
    expect(cardOf(OPENING, { 'openers.i1': [H(1), H(2)] })).toBeNull();
  });

  it('the openers are asked of the side batting next, from its own order', () => {
    const display = displayOf(FIRST_INNINGS_8);
    expect(setupStep(display)).toBe('openers');
    const view = setupView(display);
    expect([view.batting?.label, view.fielding?.label]).toEqual(['Away CC', 'Home CC']);
    expect(view.order.map((one) => one.id)).toEqual(AWAY_ELEVEN);
    expect(view.bowlers.map((one) => one.id)).toEqual(HOME_ELEVEN);
  });

  it('with the openers and the bowler picked it is ready for Start innings', () => {
    const picked = { 'openers.i2': [A(1), A(2)], 'bowler.i2.0': [H(11)] };
    expect(setupStep(displayOf(FIRST_INNINGS_8, picked))).toBe('ready');
  });

  // Law 14 (the follow-on), TWO_INNINGS' lead of 200: 300 against 50 lets the home side make the away side bat again.
  it('two innings a side: the lead, and the follow-on in More while it may be enforced', () => {
    const bootstrap = withCfg(MATCH, TWO_INNINGS);
    const second = [...OPENING, summary(300, 10, 300)];
    expect(cardOf(second, NO_PICKS, bootstrap)).toStrictEqual({
      title: 'Innings break',
      line: 'Home CC 300/10 (50 ov) · Home CC lead by 300 runs',
    });
    const third = [...second, summary(50, 10, 120)];
    expect(cardOf(third, NO_PICKS, bootstrap)?.line).toBe(
      'Away CC 50/10 (20 ov) · Home CC lead by 250 runs',
    );
    expect(cricketMoreItems(displayOf(third, NO_PICKS, bootstrap))).toEqual([
      'followOn',
      'matchClose',
    ]);
    // The home side bats again unless the follow-on is enforced, when the away side does.
    expect(setupView(displayOf(third, NO_PICKS, bootstrap)).batting?.label).toBe('Home CC');
    const followed = [...third, { type: 'cricket.followon', payload: {} }];
    const display = displayOf(followed, NO_PICKS, bootstrap);
    expect([display.stage, setupView(display).batting?.label]).toEqual(['break', 'Away CC']);
    expect(cricketMoreItems(display)).toEqual(['matchClose']);
  });

  it('the side batting second ahead after the first innings leads: the lead is the side ahead’s', () => {
    const bootstrap = withCfg(MATCH, TWO_INNINGS);
    const ahead = [...OPENING, summary(100, 10, 300), summary(250, 10, 300)];
    expect(cardOf(ahead, NO_PICKS, bootstrap)?.line).toBe(
      'Away CC 250/10 (50 ov) · Away CC lead by 150 runs',
    );
    const byOne = [...OPENING, summary(100, 10, 300), summary(101, 10, 300)];
    expect(cardOf(byOne, NO_PICKS, bootstrap)?.line).toBe(
      'Away CC 101/10 (50 ov) · Away CC lead by 1 run',
    );
  });

  it('scores level in a two-innings match says so', () => {
    const bootstrap = withCfg(MATCH, TWO_INNINGS);
    const level = [...OPENING, summary(120, 10, 300), summary(120, 10, 300)];
    expect(cardOf(level, NO_PICKS, bootstrap)?.line).toBe('Away CC 120/10 (50 ov) · Scores level');
  });

  it('a chase with no ball limit needs runs only', () => {
    const bootstrap = withCfg(MATCH, { ballsPerInnings: null, minOversForResult: 0 });
    expect(cardOf([...OPENING, summary(41, 10, 61)], NO_PICKS, bootstrap)?.line).toBe(
      'Home CC 41/10 (10.1 ov) · Away CC need 42',
    );
  });
});

describe('the super over (spec §4.6)', () => {
  // ICC: the side batting second in the match bats first in the super over (`soBattingSideAt`).
  it('a knockout tie goes to the super over with the side batting second first', () => {
    const display = displayOf(TIED_KO);
    expect(display.stage).toBe('superOverSetup');
    // T19 D12: a tie card says both sides' scores, the tied pair.
    expect(cardOf(TIED_KO)).toStrictEqual({
      title: 'Tied — super over',
      line: 'Home CC 8/0 (2 ov) · Away CC 8/0 (2 ov)',
    });
    const view = setupView(display);
    expect([view.batting?.label, view.fielding?.label]).toEqual(['Away CC', 'Home CC']);
    expect(view.order.map((one) => one.id)).toEqual(AWAY_ELEVEN);
    expect(view.nextOpeners).toEqual({ striker: A(1), nonStriker: A(2) });
    // The super over takes nothing but its own balls: More is empty.
    expect(cricketMoreItems(display)).toEqual([]);
  });

  it('the super over’s second innings chases the first’s runs and one', () => {
    const seven = superOverOf('A', H(11), [FOUR, ONE, ONE, DOT, ONE, OUT]);
    expect(cardOf([...TIED_KO, ...seven])).toStrictEqual({
      title: 'Super over',
      line: 'Away CC 7/1 (1 ov) · Home CC need 8 off 6 balls',
    });
  });

  // SUPER_OVER_TIED: `superOverStillTied` decides: `repeat` plays another (the side batting second in the first now bats first, ICC),
  // `boundary_count` gives it to the side with more boundaries, `shared` leaves the tie.
  it('a second super-over tie follows superOverStillTied', () => {
    const tied = SUPER_OVER_TIED;
    const repeat = displayOf(
      tied,
      NO_PICKS,
      withCfg(MATCH, { ...KO_2, superOverStillTied: 'repeat' }),
    );
    expect([repeat.stage, repeat.innings?.ordinal, repeat.innings?.batting]).toEqual([
      'superOverSetup',
      's3',
      'first',
    ]);
    expect(cricketBreakCard(repeat)?.title).toEqual({
      key: 'scoring.cricket.break.tiedAgain',
      vars: { number: 2 },
    });
    // A batter a super over dismissed bats in no later one: H-p2 is not offered.
    const view = setupView(repeat);
    expect(view.order.map((one) => one.id)).toEqual(HOME_ELEVEN.filter((id) => id !== H(2)));
    expect(view.nextOpeners).toEqual({ striker: H(1), nonStriker: H(3) });

    const boundaries = displayOf(
      tied,
      NO_PICKS,
      withCfg(MATCH, { ...KO_2, superOverStillTied: 'boundary_count' }),
    );
    expect([boundaries.stage, boundaries.result]).toEqual([
      'decided',
      { margin: { kind: 'boundary_count' }, winner: 'second' },
    ]);
    const shared = displayOf(
      tied,
      NO_PICKS,
      withCfg(MATCH, { ...KO_2, superOverStillTied: 'shared' }),
    );
    expect([shared.stage, shared.result]).toEqual([
      'decided',
      { margin: { kind: 'tie' }, winner: null },
    ]);
  });

  // ▲▼ in the super over's setup move a batter among those it offers; the one it left out keeps their place.
  it('a move in a super over’s order skips the batter it does not offer', () => {
    const display = displayOf(SUPER_OVER_TIED);
    // H-p3 is second on the list shown (H-p2 is out of it): up one puts them first.
    expect(orderMoved(display, 1, 0).slice(0, 4)).toEqual([H(3), H(2), H(1), H(4)]);
    expect(orderMoved(displayOf(FIRST_INNINGS_8), 2, 1).slice(0, 3)).toEqual([A(1), A(3), A(2)]);
  });
});

describe('the result (spec §4.7)', () => {
  it('won by 4 wickets reads in four languages', () => {
    const display = displayOf(WON_BY_4);
    expect([display.stage, display.result]).toEqual([
      'decided',
      { margin: { kind: 'wickets', value: 4 }, winner: 'second' },
    ]);
    const view = cricketPad(display);
    // The result heads the recorded card now (T19 fix 5); the strip is left empty.
    expect(view.strip[0]?.text).toBeNull();
    const words = view.card?.kind === 'resultRecorded' ? (view.card.title ?? null) : null;
    const said = (lang: 'en' | 'es' | 'fr' | 'nl') =>
      words === null ? null : translatePad(createTranslator(lang), words);
    expect(said('en')).toBe('Away CC won by 4 wickets');
    expect(said('es')).toBe('Away CC ganó por 4 wickets');
    expect(said('fr')).toBe('Away CC a gagné par 4 wickets');
    expect(said('nl')).toBe('Away CC won met 4 wickets');
    // "Result recorded — the organiser finalizes it": the kit's card, with the Undo window filled in by the hook.
    expect(view.card).toMatchObject({ kind: 'resultRecorded', undoLeft: null });
    expect(cricketBreakCard(display)).toBeNull();
  });
});

// The fixtures are what a server takes: every event judged as an append, strictly, as `cricketRefusalOf` does.
describe('the fixtures', () => {
  it.each([
    ['SUPER_OVER_TIED', SUPER_OVER_TIED],
    ['WON_BY_4', WON_BY_4],
  ])('%s is taken event by event', (_name, specs) => {
    const match = cricketMatchOf(MATCH);
    if (match === null) throw new Error('a cricket fixture');
    const all = ledgerOf(specs).map((event) => envelopeOf(MATCH.fixtureId, event));
    const refused = all.filter((_, i) => cricketRefusalOf(match, all.slice(0, i + 1)) !== null);
    expect(refused).toStrictEqual([]);
  });
});

// T19 device run D12 (the owner: "I played superover, and made it draw then it restarting the superover again"): every
// super-over boundary showed the same "Tied — super over" card with one innings' score, and Match details numbered each
// super-over innings as a super over of its own (1 to 5). A super over is two innings (`soBattingSideAt`'s pairs).
describe('repeated super overs (T19 D12)', () => {
  /** The third super over's first half: the away side, H-p7 bowling, six singles. */
  const THIRD_FIRST_HALF = [...TWO_SUPER_OVERS_TIED, ...superOverOf('A', H(7), times(6, ONE))];

  it('a tie of a super over names the one that comes next, and both sides’ scores', () => {
    const display = displayOf(TWO_SUPER_OVERS_TIED);
    expect([display.stage, display.innings?.ordinal, display.innings?.batting]).toEqual([
      'superOverSetup',
      's5',
      'second',
    ]);
    expect(cardOf(TWO_SUPER_OVERS_TIED)).toStrictEqual({
      title: 'Tied again — super over 3',
      line: 'Home CC 2/0 (1 ov) · Away CC 2/0 (1 ov)',
    });
    // The second super over's twelve balls off: the first tied, the second due.
    const once = TWO_SUPER_OVERS_TIED.slice(0, -12);
    expect(cardOf(once)).toStrictEqual({
      title: 'Tied again — super over 2',
      line: 'Away CC 2/0 (1 ov) · Home CC 2/0 (1 ov)',
    });
  });

  it('half-way through a super over the card is the chase, with its target', () => {
    expect(cardOf(THIRD_FIRST_HALF)).toStrictEqual({
      title: 'Super over',
      line: 'Away CC 6/0 (1 ov) · Home CC need 7 off 6 balls',
    });
  });

  it('the board and History number the super over, not its innings: 1, 1, 2, 2, 3', () => {
    const display = displayOf(THIRD_FIRST_HALF, {
      'openers.s6': [H(1), H(2)],
      'bowler.s6.0': [A(7)],
      'begin.s6': ['first'],
    });
    const board = cricketBoard(display);
    expect(
      board.score === null ? null : [board.score.team, translatePad(en, board.score.innings)],
    ).toStrictEqual(['Home CC', 'Super over 3']);
    const folded = foldCricket({
      bootstrap: MATCH,
      ledger: ledgerOf(THIRD_FIRST_HALF),
      queued: [],
      ownEventIds: [],
      toss: null,
      picks: NO_PICKS,
    });
    if (folded.kind !== 'folded') throw new Error('did not fold');
    expect(folded.history.map((group) => translatePad(en, group.heading))).toEqual([
      'Super over 3 · Away CC',
      'Super over 2 · Away CC',
      'Super over 2 · Home CC',
      'Super over 1 · Home CC',
      'Super over 1 · Away CC',
      'Innings 2 · Away CC',
      'Innings 1 · Home CC',
    ]);
  });
});

// T19 device run 6, D13: the status line kept the last ball's words ("1 run", "Dot ball") on the innings-break card, on the
// next innings' order and first-bowler steps, on the tie's card and on the super-over cards, where they say nothing true.
// At those stages the line is empty (with its Undo, which takes that ball back) until the next action; an Undo's own line
// stays, and so does "Innings 2 started" once Start innings is tapped, which is the live stage's.
describe('the status line at a break (T19 D13)', () => {
  /** The pad's status line at the end of a ledger: its words (null when it has none), and whether Undo is lit. */
  function lineOf(
    specs: readonly Spec[],
    own: readonly number[] = [],
    picks: PendingPicks = NO_PICKS,
    bootstrap = MATCH,
  ) {
    const folded = foldCricket({
      bootstrap,
      ledger: ledgerOf(specs),
      queued: [],
      ownEventIds: own.map(eventId),
      toss: null,
      picks,
    });
    if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
    const { lastTap } = cricketPad(folded.display);
    const text = lastTap?.text ?? null;
    return {
      stage: folded.display.stage,
      text: text === null ? null : translatePad(en, text),
      undo: lastTap?.undo ?? false,
    };
  }

  /** Home's innings ends on a single, as the device's did: 1/0 off 12 balls, the last "1 run". 14 events. */
  const ENDS_ON_ONE = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, [...times(11, DOT), ONE])];
  const LAST = ENDS_ON_ONE.length;
  const chase = (more: object = {}) =>
    ball({ over: 0, ballInOver: 1, striker: A(1), nonStriker: A(2), bowler: H(11), ...more });

  it('the innings break: the last ball’s words are gone, its Undo is lit (the ball is this phone’s)', () => {
    expect(lineOf(ENDS_ON_ONE, [LAST])).toStrictEqual({ stage: 'break', text: null, undo: true });
  });

  it('the ball before the last is spoken while its innings is open, and the closing ball stays silent through the openers and the bowler', () => {
    expect(lineOf(ENDS_ON_ONE.slice(0, -1), [LAST - 1])).toStrictEqual({
      stage: 'live',
      text: 'Dot ball',
      undo: true,
    });
    expect(lineOf(ENDS_ON_ONE, [LAST]).text).toBeNull();
    const picked = { 'openers.i2': [A(1), A(2)], 'bowler.i2.0': [H(11)] };
    expect(lineOf(ENDS_ON_ONE, [LAST], picked)).toStrictEqual({
      stage: 'break',
      text: null,
      undo: true,
    });
  });

  it('a console’s last ball leaves the line empty and Undo dim', () => {
    expect(lineOf(ENDS_ON_ONE)).toStrictEqual({ stage: 'break', text: null, undo: false });
  });

  it('Start innings is a line of its own: “Innings 2 started”', () => {
    const picked = { 'openers.i2': [A(1), A(2)], 'bowler.i2.0': [H(11)], 'begin.i2': ['second'] };
    expect(lineOf(ENDS_ON_ONE, [LAST], picked)).toStrictEqual({
      stage: 'live',
      text: 'Innings 2 started',
      undo: true,
    });
  });

  it('the tie: neither “Dot ball” nor any ball under “Tied — super over”', () => {
    expect(lineOf(TIED_KO, [TIED_KO.length])).toStrictEqual({
      stage: 'superOverSetup',
      text: null,
      undo: true,
    });
    // The same tie in a league is the result, with its last ball spoken as before.
    const league = withCfg(MATCH, LEAGUE_2);
    expect(lineOf(TIED_KO, [TIED_KO.length], NO_PICKS, league)).toStrictEqual({
      stage: 'decided',
      text: 'Dot ball',
      undo: true,
    });
  });

  it('the super over’s own cards: its first innings’ last ball and a tied super over’s last', () => {
    const half = [...TIED_KO, ...superOverOf('A', H(9), [ONE, ONE, DOT, DOT, DOT, DOT])];
    expect(lineOf(half, [half.length])).toStrictEqual({
      stage: 'superOverSetup',
      text: null,
      undo: true,
    });
    expect(lineOf(TWO_SUPER_OVERS_TIED, [TWO_SUPER_OVERS_TIED.length])).toStrictEqual({
      stage: 'superOverSetup',
      text: null,
      undo: true,
    });
    // A super over under way speaks its last ball.
    const under = [...TIED_KO, ...superOverOf('A', H(9), [ONE, DOT])];
    expect(lineOf(under, [under.length])).toStrictEqual({
      stage: 'live',
      text: 'Dot ball',
      undo: true,
    });
  });

  it('an Undo that lands on the break keeps its “Undone — …” line, and Undo stays lit over the ball before', () => {
    const undone = [...ENDS_ON_ONE, chase({ bat: 1 }), voiding(LAST + 1)];
    expect(lineOf(undone, [LAST, LAST + 1, LAST + 2])).toStrictEqual({
      stage: 'break',
      text: 'Undone — 1 run',
      undo: true,
    });
  });

  it('a tap made at the break speaks for itself: a rain stoppage is no stale ball', () => {
    const rain = { type: 'cricket.interruption', payload: { kind: 'rain' } };
    expect(lineOf([...ENDS_ON_ONE, rain], [LAST, LAST + 1])).toStrictEqual({
      stage: 'break',
      text: 'Interruption recorded',
      undo: true,
    });
  });

  // The controller's ruling (round 2, I2): every tap that ENDS an innings is silent on the break card that follows, the
  // card being the news. One case per kind, so none can drop out of the guard unseen.
  describe('every tap that ends an innings is silent at the break that follows', () => {
    const oneRun = ball({
      over: 0,
      ballInOver: 1,
      striker: H(1),
      nonStriker: H(2),
      bowler: A(11),
      bat: 1,
    });

    it('over totals that close it, both sides’ players entered', () => {
      const totals = [...OPENING, summary(8, 0, 12)];
      expect(lineOf(totals, [3])).toStrictEqual({ stage: 'break', text: null, undo: true });
    });

    it('a retirement that ends it: nine down, the tenth retires out', () => {
      const nine = [...OPENING, ...inningsOf('H', AWAY_BOWLERS, [ONE, ...times(9, OUT)])];
      const retired = [...nine, retire(H(7), 'out')];
      expect(lineOf(retired, [retired.length])).toStrictEqual({
        stage: 'break',
        text: null,
        undo: true,
      });
    });

    it('a declaration, two innings a side', () => {
      const declared = [...OPENING, oneRun, declare()];
      const two = withCfg(MATCH, TWO_INNINGS);
      expect(lineOf(declared, [4], NO_PICKS, two)).toStrictEqual({
        stage: 'break',
        text: null,
        undo: true,
      });
    });

    it('More’s close', () => {
      const close: Spec = { type: 'cricket.innings.close', payload: { reason: 'weather' } };
      expect(lineOf([...OPENING, oneRun, close], [4])).toStrictEqual({
        stage: 'break',
        text: null,
        undo: true,
      });
    });

    it('over totals that close it, with the next innings’ openers and bowler picked: still silent', () => {
      const picked = { 'openers.i2': [A(1), A(2)], 'bowler.i2.0': [H(11)] };
      expect(lineOf([...OPENING, summary(8, 0, 12)], [3], picked)).toStrictEqual({
        stage: 'break',
        text: null,
        undo: true,
      });
    });
  });

  // Not an end of an innings: the follow-on is a fresh tap made AT the break (the second innings is already closed), so it
  // says itself, as before.
  it('a follow-on enforced at the break speaks: “Follow-on enforced”, Undo lit', () => {
    const two = withCfg(MATCH, TWO_INNINGS);
    const followed = [
      ...OPENING,
      summary(300, 10, 300),
      summary(50, 10, 120),
      { type: 'cricket.followon', payload: {} },
    ];
    expect(lineOf(followed, [5], NO_PICKS, two)).toStrictEqual({
      stage: 'break',
      text: 'Follow-on enforced',
      undo: true,
    });
    // The second innings' over totals before it ended it: silent, the follow-on's question is on the card.
    expect(lineOf(followed.slice(0, -1), [4], NO_PICKS, two)).toStrictEqual({
      stage: 'break',
      text: null,
      undo: true,
    });
  });

  it('over totals keep their line: a side with no players is in totals, not at a break', () => {
    const totals = lineOf(
      [toss('A', 'bat'), start(), summary(9, 0, 6)],
      [3],
      NO_PICKS,
      NO_AWAY_PLAYERS,
    );
    expect(totals).toStrictEqual({
      stage: 'totals',
      text: 'Over recorded · 9/0 (1 ov)',
      undo: true,
    });
  });

  // The controller's ruling: the over totals' line stays in the totals pad's stages, as the entry's confirmation. A tie
  // of two sides scored in over totals (8/0 and 8/1 off two overs; the away side has no players) is the tie card's
  // `tiedNoPlayers`, not a break: it is not silenced.
  it('a tie in over totals keeps its line: “Over recorded”, not silenced like a break’s', () => {
    const tied = [...OPENING, summary(8, 0, 12), summary(8, 1, 12)];
    expect(lineOf(tied, [4], NO_PICKS, NO_AWAY_PLAYERS)).toStrictEqual({
      stage: 'tiedNoPlayers',
      text: 'Over recorded · 8/1 (2 ov)',
      undo: true,
    });
  });
});

// T19 fix 5: the batting team's name heads the board, and a result says who won with both sides' scores of the contest.
describe('the board names the team, and a result names the winner (T19 fix 5)', () => {
  /** The knockout tied, the away side's super over 2/0, then the home side's four off its first ball: home wins on it. */
  const SUPER_OVER_WON: readonly Spec[] = [
    ...TIED_KO,
    ...superOverOf('A', player('H', 9), [ONE, ONE, ...times(4, DOT)]),
    ...superOverOf('H', player('A', 9), [FOUR]),
  ];

  it('a super over’s board: the team on its own, then "Super over 2" without it', () => {
    const board = cricketBoard(displayOf(TIED_KO));
    expect(board.score?.team).toBe('Away CC');
    const superOver = cricketBoard(displayOf([...TWO_SUPER_OVERS_TIED]));
    expect(superOver.score?.team).toBe('Away CC');
    expect(translatePad(createTranslator('en'), superOver.score!.innings)).toBe('Super over 3');
  });

  it('decided on a super over: both halves of it, the side that batted first on top; the card says who won', () => {
    const display = displayOf(SUPER_OVER_WON);
    const view = cricketPad(display);
    expect(display.stage).toBe('decided');
    expect(cricketBoard(display).result).toStrictEqual([
      { team: 'Away CC', figures: '2/0', overs: '1' },
      { team: 'Home CC', figures: '4/0', overs: '0.1' },
    ]);
    const title = view.card?.kind === 'resultRecorded' ? view.card.title : undefined;
    expect(translatePad(createTranslator('en'), title!)).toBe('Home CC won on the super over');
    expect(view.strip[0]?.text).toBeNull();
  });

  it('decided in its innings: the two innings, the first side on top; not a result before then', () => {
    const decided = cricketBoard(
      displayOf([...ALL_OUT_FIRST, ...inningsOf('A', HOME_BOWLERS, [ONE, ONE])]),
    );
    expect(decided.result).toStrictEqual([
      { team: 'Home CC', figures: '1/10', overs: '1.5' },
      { team: 'Away CC', figures: '2/0', overs: '0.2' },
    ]);
    expect(cricketBoard(displayOf(FIRST_INNINGS_8)).result).toBeNull();
  });

  it('a tie of the whole match with no super over shows the two innings and the words "Match tied"', () => {
    const display = displayOf(TIED_KO, NO_PICKS, withCfg(MATCH, LEAGUE_2));
    const view = cricketPad(display);
    const title = view.card?.kind === 'resultRecorded' ? view.card.title : undefined;
    expect(title && translatePad(createTranslator('en'), title)).toBe('Match tied');
    expect(cricketBoard(display).result).toStrictEqual([
      { team: 'Home CC', figures: '8/0', overs: '2' },
      { team: 'Away CC', figures: '8/0', overs: '2' },
    ]);
  });
});
