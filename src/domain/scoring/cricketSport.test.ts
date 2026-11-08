import { describe, expect, it } from 'vitest';
import { cricketPad } from '@/domain/scoring/cricketPad';
import { cricketSport } from '@/domain/scoring/cricketSport';
import type { CricketTap } from '@/domain/scoring/cricketTypes';
import { NO_PICKS } from '@/domain/scoring/pendingPicks';
import { sportFor } from '@/domain/scoring/sports';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import {
  ALL_OUT_FIRST,
  FIRST_INNINGS_8,
  HOME_BOWLERS,
  MATCH,
  ONE,
  OPENING,
  OVER_ONE_DONE,
  TIED_KO,
  ball,
  eventId,
  inningsOf,
  ledgerOf,
  player,
  toss,
  type Spec,
} from '../../../test/cricketLedger';

// Cricket as the match runtime scores it (S2-4 plan Task 7): the sport's table row, its stages as the runtime asks them,
// Home's result line and the pad's halves. Every expected value is written out from the spec, never read from the fold.

function displayOf(specs: readonly Spec[], own: readonly number[] = []) {
  const folded = cricketSport.fold({
    bootstrap: MATCH,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: own.map(eventId),
    toss: null,
    picks: NO_PICKS,
  });
  if (folded.kind !== 'folded') throw new Error(`did not fold: ${folded.reason}`);
  return folded.display;
}

/** The home side all out for 1, then the away side's two singles off the first two balls: away wins by 10 wickets. */
const DECIDED: readonly Spec[] = [...ALL_OUT_FIRST, ...inningsOf('A', HOME_BOWLERS, [ONE, ONE])];

const en = createTranslator('en');

/** A single off ball `ballInOver` of the first over, the openers in, `A-p11` bowling. */
const single = (ballInOver: number) =>
  ball({
    over: 0,
    ballInOver,
    striker: player('H', 1),
    nonStriker: player('H', 2),
    bowler: player('A', 11),
    bat: 1,
  });

/** The single as its tap. */
const ONE_RUN = { bat: 1, extra: null, boundary: null, wicket: null } as const;

describe('cricketSport', () => {
  it('sportFor(cricket) is the module', () => {
    expect(sportFor('cricket')).toBe(cricketSport);
    expect(cricketSport.key).toBe('cricket');
  });

  it('notStarted at setup and at the toss; not after Start', () => {
    expect(cricketSport.notStarted(displayOf([]))).toBe(true);
    expect(cricketSport.notStarted(displayOf([toss('H', 'bat')]))).toBe(true);
    expect(cricketSport.notStarted(displayOf(OPENING))).toBe(false);
    expect(cricketSport.notStarted(displayOf(OVER_ONE_DONE))).toBe(false);
  });

  it('a live match is not decided: an innings under way, a break, a super over due', () => {
    expect(cricketSport.decided(displayOf([]))).toBe(false);
    expect(cricketSport.decided(displayOf(OVER_ONE_DONE))).toBe(false);
    expect(cricketSport.decided(displayOf(FIRST_INNINGS_8))).toBe(false);
    expect(cricketSport.decided(displayOf(TIED_KO))).toBe(false);
    expect(cricketSport.decided(displayOf(DECIDED))).toBe(true);
  });

  it('the result line is each innings’ runs/wickets, joined: numbers only', () => {
    expect(cricketSport.resultLine(displayOf(DECIDED))).toBe('1/10 · 2/0');
    expect(cricketSport.resultLine(displayOf(TIED_KO))).toBe('8/0 · 8/0');
    expect(cricketSport.resultLine(displayOf(OPENING))).toBe('');
  });

  it('holds no serve pick, waits on no ending, and refuses a tap as not now', () => {
    expect(cricketSport.tossOf({ kind: 'start' })).toBeNull();
    expect(cricketSport.tossOf({ kind: 'toss', wonBy: 'first', elected: 'bat' })).toBeNull();
    expect(cricketSport.awaitingEnding(displayOf(OVER_ONE_DONE))).toBe(false);
    expect(cricketSport.refusalFor({ kind: 'start' })).toBe('notNow');
  });

  it('Undo names the last tap, and shows it taken back; the toss and the start are never named', () => {
    const display = displayOf([...OPENING, single(1)], [3]);
    const tap: CricketTap = { kind: 'ball', ball: ONE_RUN };
    expect(cricketSport.undoneOf(display)).toStrictEqual(tap);
    expect(cricketSport.undoneOf(displayOf(OPENING, [1, 2]))).toBeNull();
    const shown = cricketSport.showUndone(display, { kind: 'ball', ball: tap.ball });
    expect(shown.lastTap).toStrictEqual({ kind: 'undone', tap });
    expect(cricketSport.undoneOf(shown)).toBeNull();
  });
});

describe('cricketPad', () => {
  it('the halves carry the side names, with no tap; the side batting is lit', () => {
    const view = cricketPad(displayOf(OVER_ONE_DONE));
    expect(
      view.halves.map((half) => [half.label, half.value, half.bar, half.tappable]),
    ).toStrictEqual([
      ['Home CC', '6/0', 'lit', false],
      ['Away CC', '', 'dim', false],
    ]);
    expect(view.start).toBeNull();
    expect(view.tools).toStrictEqual([]);
    expect(view.card).toBeNull();
  });

  it('the last tap in words, with Undo while this phone’s own tap stands', () => {
    const own = cricketPad(displayOf([...OPENING, single(1)], [3])).lastTap;
    expect(own === null ? null : [translatePad(en, own.text), own.undo]).toStrictEqual([
      '1 run',
      true,
    ]);
    const theirs = cricketPad(displayOf([...OPENING, single(1)])).lastTap;
    expect(theirs === null ? null : [translatePad(en, theirs.text), theirs.undo]).toStrictEqual([
      '1 run',
      false,
    ]);
  });

  it('a tap Undo took back is said as undone, with no Undo of its own', () => {
    const display = displayOf([...OPENING, single(1)], [3]);
    const undone = cricketSport.showUndone(display, { kind: 'ball', ball: ONE_RUN });
    const line = cricketPad(undone).lastTap;
    expect(line === null ? null : [translatePad(en, line.text), line.undo]).toStrictEqual([
      'Undone — 1 run',
      false,
    ]);
  });

  it('a screen reader hears the innings now, or that there is no score yet', () => {
    expect(translatePad(en, cricketPad(displayOf(OVER_ONE_DONE)).tally.said)).toBe('Score: 6/0');
    expect(translatePad(en, cricketPad(displayOf([])).tally.said)).toBe('No score yet');
  });

  it('a decided match: the result in words in the strip, and the recorded result’s card', () => {
    const view = cricketPad(displayOf(DECIDED));
    const note = view.strip[0]?.text ?? null;
    expect(note === null ? null : translatePad(en, note)).toBe('Away CC won by 10 wickets');
    expect(view.card).toStrictEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(cricketPad(displayOf(TIED_KO)).strip).toStrictEqual([{ slot: 'note', text: null }]);
  });

  it('Match details carry the rules of the format', () => {
    const rules = cricketPad(displayOf(OPENING)).details.rules;
    expect(rules.map((row) => translatePad(en, row.value))).toStrictEqual([
      '2 an innings',
      '6 balls',
      '11 a side',
      'Up to 1 over',
      'On',
    ]);
  });
});
