import { describe, expect, it } from 'vitest';
import { cricketMatchOf, cricketRefusalOf } from '@/domain/scoring/cricketEngine';
import { cricketEventFor } from '@/domain/scoring/cricketEvents';
import { foldCricket } from '@/domain/scoring/cricketFold';
import { cricketPad } from '@/domain/scoring/cricketPad';
import {
  stepOver,
  totalsTap,
  totalsView,
  type CricketTotalsEntry,
  type TotalsOver,
} from '@/domain/scoring/cricketTotals';
import type { CricketDisplay } from '@/domain/scoring/cricketTypes';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import { envelopeOf } from '@/domain/scoring/setBasedEngine';
import type { Bootstrap } from '@/domain/scoring/wire';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import {
  KO_2,
  LEAGUE_2,
  MATCH,
  NO_AWAY_PLAYERS,
  OPENING,
  ledgerOf,
  summary,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';

// Players not entered: over totals (S2-4 spec §4.10, ruling 66, ruling 74; plan Task 17), read off the fold as the totals
// entry shows them. The away side's team sheet is not entered (`NO_AWAY_PLAYERS`), so the match is scored in over totals;
// the home side bats first. Every expected value is written out from the spec and the Laws, and the engine's own verdict
// on the event the entry makes is asked of the engine as the server asks it, never of the code under test.

function displayOf(specs: readonly Spec[], bootstrap: Bootstrap = NO_AWAY_PLAYERS): CricketDisplay {
  const folded = foldCricket({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
    picks: NO_PICKS,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

function entryOf(display: CricketDisplay): CricketTotalsEntry {
  const view = totalsView(display);
  if (view?.kind !== 'entry') throw new Error(`no entry: ${JSON.stringify(view)}`);
  return view;
}

/** The server's word on the event a tap makes, after the ledger as it stands: null when the engine takes it. */
function refusalOf(specs: readonly Spec[], bootstrap: Bootstrap, over: TotalsOver) {
  const display = displayOf(specs, bootstrap);
  const tap = totalsTap(display, over);
  const event = tap === null ? null : cricketEventFor(tap, { bootstrap, display });
  if (event === null) return 'no event';
  const match = cricketMatchOf(bootstrap);
  if (match === null) throw new Error('a cricket fixture');
  const ledger = ledgerOf([...specs, { type: event.type, payload: event.payload }]);
  const all = ledger.map((one) => envelopeOf(bootstrap.fixtureId, one));
  return cricketRefusalOf(match, all);
}

const en = createTranslator('en');
const wordsOf = (text: Parameters<typeof translatePad>[1]) => translatePad(en, text);

describe('the over to enter', () => {
  it('two overs send running totals 8/0 then 15/1', () => {
    const first = displayOf(OPENING);
    expect(entryOf(first).over).toBe(1);
    expect(totalsTap(first, { runs: 8, wickets: 0, balls: 6 })).toStrictEqual({
      kind: 'summary',
      runs: 8,
      wickets: 0,
      legalBalls: 6,
    });
    const second = displayOf([...OPENING, summary(8, 0, 6)]);
    expect(entryOf(second).over).toBe(2);
    expect(totalsTap(second, { runs: 7, wickets: 1, balls: 6 })).toStrictEqual({
      kind: 'summary',
      runs: 15,
      wickets: 1,
      legalBalls: 12,
    });
  });

  it('the event it makes is over totals with partial: true, and the engine takes it', () => {
    const tap = totalsTap(displayOf(OPENING), { runs: 8, wickets: 0, balls: 6 });
    if (tap === null) throw new Error('a tap');
    const display = displayOf(OPENING);
    expect(cricketEventFor(tap, { bootstrap: NO_AWAY_PLAYERS, display })).toStrictEqual({
      type: 'cricket.innings.summary',
      payload: { runs: 8, wickets: 0, legalBalls: 6, partial: true },
    });
    expect(refusalOf(OPENING, NO_AWAY_PLAYERS, { runs: 8, wickets: 0, balls: 6 })).toBeNull();
    expect(
      refusalOf([...OPENING, summary(8, 0, 6)], NO_AWAY_PLAYERS, { runs: 7, wickets: 1, balls: 6 }),
    ).toBeNull();
  });

  it('starts at no runs, no wickets and a whole over', () => {
    expect(entryOf(displayOf(OPENING)).start).toStrictEqual({ runs: 0, wickets: 0, balls: 6 });
  });

  // A format whose innings is not a whole number of overs (fifteen balls of six) ends on a part over of three.
  it('a part last over sends its legal balls', () => {
    const PART = withCfg(NO_AWAY_PLAYERS, { ...KO_2, ballsPerInnings: 15 });
    const specs = [...OPENING, summary(8, 0, 6), summary(15, 1, 12)];
    const display = displayOf(specs, PART);
    const { start } = entryOf(display);
    expect(start).toStrictEqual({ runs: 0, wickets: 0, balls: 3 });
    expect(totalsTap(display, { ...start, runs: 4 })).toStrictEqual({
      kind: 'summary',
      runs: 19,
      wickets: 1,
      legalBalls: 15,
    });
    expect(refusalOf(specs, PART, { ...start, runs: 4 })).toBeNull();
  });

  it('a whole over in a format of whole overs starts at six, at the first over and the last', () => {
    expect(entryOf(displayOf([...OPENING, summary(8, 0, 6)])).start.balls).toBe(6);
  });

  // Review of Batch 5, I1: a part over leaves the rest of its over, not a whole one, to enter.
  it('after a part over, the balls start at what is left of that over', () => {
    const third = entryOf(displayOf([...OPENING, summary(4, 0, 3)]));
    expect(third.over).toBe(1);
    expect(third.start).toStrictEqual({ runs: 0, wickets: 0, balls: 3 });
    // Anti-vacuity: a part over inside the second over leaves the rest of that one.
    const later = entryOf(displayOf([...OPENING, summary(8, 0, 6), summary(10, 0, 10)]));
    expect(later.over).toBe(2);
    expect(later.start.balls).toBe(2);
  });

  it('what is left of the innings caps it when that is less than what is left of the over', () => {
    // Fifteen balls of six: after thirteen, two are left of the innings and five of the over.
    const PART = withCfg(NO_AWAY_PLAYERS, { ...KO_2, ballsPerInnings: 15 });
    const display = displayOf([...OPENING, summary(8, 0, 6), summary(15, 1, 13)], PART);
    expect(entryOf(display).start.balls).toBe(2);
  });

  it('a chase that passes the target mid-over sends the balls it took', () => {
    // KO_2: 8 off the first innings' two overs, so the reply needs 9. Four runs off the first over, then five off the
    // first four balls of the second wins it: ten legal balls.
    const specs = [...OPENING, summary(8, 0, 12), summary(4, 0, 6)];
    const display = displayOf(specs);
    expect(totalsTap(display, { runs: 5, wickets: 0, balls: 4 })).toStrictEqual({
      kind: 'summary',
      runs: 9,
      wickets: 0,
      legalBalls: 10,
    });
    expect(refusalOf(specs, NO_AWAY_PLAYERS, { runs: 5, wickets: 0, balls: 4 })).toBeNull();
  });
});

describe('what an over may hold', () => {
  it.each([
    ['a negative number of runs', { runs: -1, wickets: 0, balls: 6 }],
    ['a fraction of a run', { runs: 1.5, wickets: 0, balls: 6 }],
    ['not a number of runs', { runs: Number.NaN, wickets: 0, balls: 6 }],
    ['a negative number of wickets', { runs: 0, wickets: -1, balls: 6 }],
    ['a fraction of a ball', { runs: 0, wickets: 0, balls: 2.5 }],
    ['no balls', { runs: 0, wickets: 0, balls: 0 }],
    ['more balls than an over has', { runs: 0, wickets: 0, balls: 7 }],
    ['more wickets than the side has', { runs: 0, wickets: 11, balls: 6 }],
  ])('%s makes no tap', (_, over) => {
    expect(totalsTap(displayOf(OPENING), over)).toBeNull();
  });

  // The engine's monotone rule, not the pad's: a figure that takes the running total down is refused after an over too.
  it('a negative figure after an over makes no tap (the running total may not go down)', () => {
    const display = displayOf([...OPENING, summary(8, 1, 6)]);
    expect(totalsTap(display, { runs: -1, wickets: 0, balls: 6 })).toBeNull();
    expect(totalsTap(display, { runs: 0, wickets: -1, balls: 6 })).toBeNull();
    expect(totalsTap(display, { runs: 0, wickets: 0, balls: 6 })).not.toBeNull();
  });

  it('more balls than the innings has left makes no tap', () => {
    const display = displayOf([...OPENING, summary(8, 0, 6), summary(10, 0, 9)]);
    expect(totalsTap(display, { runs: 0, wickets: 0, balls: 4 })).toBeNull();
    expect(totalsTap(display, { runs: 0, wickets: 0, balls: 3 })).not.toBeNull();
  });

  it('before the toss, and once decided, there is no over to enter', () => {
    expect(totalsView(displayOf([]))).toBeNull();
    const decided = displayOf([...OPENING, summary(8, 0, 12), summary(9, 0, 10)]);
    expect(decided.stage).toBe('decided');
    expect(totalsTap(decided, { runs: 1, wickets: 0, balls: 1 })).toBeNull();
  });

  // The entry offers exactly what the engine takes: a grid of overs against a chase, each judged by the engine itself.
  it('agrees with the engine on every over of a grid, in a chase', () => {
    const specs = [...OPENING, summary(8, 0, 12), summary(4, 0, 6)];
    const display = displayOf(specs);
    const grid = Array.from({ length: 22 }, (_, runs) => runs).flatMap((runs) =>
      [0, 1, 2].flatMap((wickets) => [1, 3, 6].map((balls) => ({ runs, wickets, balls }))),
    );
    const disagreed = grid.filter((over) => {
      const refused = refusalOf(specs, NO_AWAY_PLAYERS, over) !== null;
      return refused !== (totalsTap(display, over) === null);
    });
    expect(disagreed).toStrictEqual([]);
    expect(grid.some((over) => totalsTap(display, over) === null)).toBe(true);
    expect(grid.some((over) => totalsTap(display, over) !== null)).toBe(true);
  });
});

// Review of Batch 5, I1: the screen starts its figures again whenever the entry is a new one, which is a different
// innings or a different count of legal balls, not a different over number (a part over is still the same over).
describe('what makes the entry a new one', () => {
  it('a part over, and the next innings, are each a new entry; the same display is the same entry', () => {
    const first = entryOf(displayOf(OPENING)).entryKey;
    expect(entryOf(displayOf(OPENING)).entryKey).toBe(first);
    const part = entryOf(displayOf([...OPENING, summary(4, 0, 3)]));
    expect(part.over).toBe(1);
    expect(part.entryKey).not.toBe(first);
    // Innings 1 all out in its first over: innings 2's over 1 is not innings 1's over 1.
    const chase = entryOf(displayOf([...OPENING, summary(3, 10, 4)]));
    expect(chase.over).toBe(1);
    expect(chase.start).toStrictEqual({ runs: 0, wickets: 0, balls: 6 });
    expect(chase.entryKey).not.toBe(first);
    expect(chase.entryKey).not.toBe(part.entryKey);
  });
});

describe('the steppers', () => {
  const OVER: TotalsOver = { runs: 3, wickets: 1, balls: 4 };

  it('move a field by one', () => {
    expect(stepOver(OVER, 'runs', 1, 6)).toStrictEqual({ runs: 4, wickets: 1, balls: 4 });
    expect(stepOver(OVER, 'wickets', -1, 6)).toStrictEqual({ runs: 3, wickets: 0, balls: 4 });
    expect(stepOver(OVER, 'balls', 1, 6)).toStrictEqual({ runs: 3, wickets: 1, balls: 5 });
  });

  it('stop at nothing for runs and wickets, at one ball and at the over', () => {
    const none: TotalsOver = { runs: 0, wickets: 0, balls: 1 };
    expect(stepOver(none, 'runs', -1, 6)).toStrictEqual(none);
    expect(stepOver(none, 'wickets', -1, 6)).toStrictEqual(none);
    expect(stepOver(none, 'balls', -1, 6)).toStrictEqual(none);
    const whole: TotalsOver = { runs: 0, wickets: 0, balls: 6 };
    expect(stepOver(whole, 'balls', 1, 6)).toStrictEqual(whole);
  });

  it('an over of eight balls takes eight', () => {
    // Anti-vacuity: the cap is the format's balls to an over, not six.
    const whole: TotalsOver = { runs: 0, wickets: 0, balls: 8 };
    expect(stepOver(whole, 'balls', 1, 8)).toStrictEqual(whole);
    expect(stepOver({ ...whole, balls: 7 }, 'balls', 1, 8).balls).toBe(8);
  });

  it('the entry says how many balls an over has, and which overs it takes', () => {
    const entry = entryOf(displayOf(OPENING));
    expect(entry.ballsMax).toBe(6);
    expect(entry.fits({ runs: 8, wickets: 0, balls: 6 })).toBe(true);
    expect(entry.fits({ runs: 0, wickets: 11, balls: 6 })).toBe(false);
  });
});

describe('what the screen says above the entry', () => {
  it('a side with no players says so, and to ask the organiser', () => {
    const entry = entryOf(displayOf(OPENING));
    expect(wordsOf(entry.note)).toBe('Players not entered — ask the organiser');
  });

  // The organiser entered the players after an innings had begun in totals: it stays in totals, and the line says why.
  it('players entered mid-innings keep totals until the next innings', () => {
    const mid = [...OPENING, summary(4, 0, 6)];
    const display = displayOf(mid, MATCH);
    expect(display.entered).toStrictEqual({ first: true, second: true });
    expect(display.stage).toBe('totals');
    const entry = entryOf(display);
    expect(entry.over).toBe(2);
    expect(wordsOf(entry.note)).toBe('This innings stays in over totals');
    // The innings' last over closes it, and the next is the ball pad's: its openers are due.
    const next = displayOf([...mid, summary(8, 0, 12)], MATCH);
    expect(next.stage).toBe('break');
    expect(next.needs).toBe('openers');
    expect(totalsView(next)).toBeNull();
  });

  // Fix round (controller, 2026-11-09): the over-end sheet no longer opens an entry, so a live match has none to show.
  it('a live match, players entered, has no entry', () => {
    const live = displayOf(OPENING, MATCH);
    expect(live.stage).toBe('live');
    expect(totalsView(live)).toBeNull();
  });
});

describe('a tie in over totals', () => {
  const TIE = [...OPENING, summary(8, 0, 12), summary(8, 1, 12)];

  it('a tie in totals mode under KO_2 stops with the organiser line', () => {
    const display = displayOf(TIE);
    expect(display.stage).toBe('tiedNoPlayers');
    const view = totalsView(display);
    expect(view?.kind).toBe('tied');
    expect(wordsOf(view?.note ?? { key: 'scoring.cricket.totals.noPlayers' })).toBe(
      'Tied — the organiser decides the super over',
    );
  });

  it('under LEAGUE_2 it is the result Tied', () => {
    const display = displayOf(TIE, withCfg(NO_AWAY_PLAYERS, LEAGUE_2));
    expect(display.stage).toBe('decided');
    expect(totalsView(display)).toBeNull();
    const strip = cricketPad(display).strip[0];
    expect(strip?.text).toStrictEqual({ key: 'scoring.cricket.result.tie' });
    expect(wordsOf(strip?.text ?? { key: 'scoring.cricket.result.draw' })).toBe('Match tied');
  });
});
