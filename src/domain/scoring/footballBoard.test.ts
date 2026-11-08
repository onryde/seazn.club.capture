import { describe, expect, it } from 'vitest';
import {
  binOver,
  footballBoard,
  footballClockBar,
  footballCorrectTime,
  footballLeads,
  footballMoreItems,
  footballTakesCorrect,
  parseFootballAction,
} from '@/domain/scoring/footballBoard';
import type { ClockBarView } from '@/domain/scoring/clockBarView';
import type { MessageKey } from '@/i18n/messages';
import en from '@/i18n/en.json';
import {
  at,
  CAPPED,
  clock,
  goal,
  LEAGUE_11,
  MATCH,
  MINI,
  NO_SHEET,
  period,
  sinBin,
  start,
  sub,
  withCfg,
} from '../../../test/footballLedger';
import {
  A,
  displayOf,
  H,
  KICK_OFF,
  KICKS_4_1,
  KICKS_4_3,
  kicks,
  LEVEL_AFTER_ET,
} from '../../../test/footballPadFixtures';

/**
 * Football's own parts of the screen (S2-5 design §6.1–§6.5; plan P Task 8): the columns, More and the clock bar. Every
 * expected value is written out from the design, never computed by the board.
 */

const button = (
  id: string,
  word: string,
  enabled: boolean,
  primary = false,
  note: { readonly key: string } | null = null,
) => ({ id, label: { key: `scoring.football.column.${word}` }, primary, enabled, note });

const playColumn = (side: 'first' | 'second', enabled: boolean, subNote: string | null = null) => [
  button(`goal.${side}`, 'goal', enabled, true),
  button(`card.${side}`, 'card', enabled),
  button(
    `sub.${side}`,
    'sub',
    enabled && subNote === null,
    false,
    subNote === null ? null : { key: `scoring.football.column.${subNote}` },
  ),
];

const actionsOf = (board: ReturnType<typeof footballBoard>) =>
  board.columns.map((column) => column.actions);

describe('footballBoard: the columns in play (design §6.2, §6.3)', () => {
  it('each column is Goal (the lime plate), Card and Sub, for its own team', () => {
    const board = footballBoard(displayOf(KICK_OFF), null);
    expect(board.columns.map((column) => column.side)).toEqual(['first', 'second']);
    expect(actionsOf(board)).toEqual([playColumn('first', true), playColumn('second', true)]);
    expect(board.kicks).toBeNull();
  });

  it('Sub reads No team sheet on NO_SHEET', () => {
    const board = footballBoard(displayOf(KICK_OFF, NO_SHEET), null);
    expect(actionsOf(board)).toEqual([
      playColumn('first', true, 'noSheet'),
      playColumn('second', true, 'noSheet'),
    ]);
  });

  it('Sub reads No subs left at the cap', () => {
    const capped = withCfg(MATCH, { ...CAPPED, maxSubs: 2 });
    const twoSubs = [
      ...KICK_OFF,
      goal({ by: 'H', at: at('H1', 600) }),
      sub({ by: 'H', off: H(7), on: H(12), at: at('H1', 600) }),
      sub({ by: 'H', off: H(8), on: H(13), at: at('H1', 600) }),
    ];
    expect(actionsOf(footballBoard(displayOf(twoSubs, capped), null))).toEqual([
      playColumn('first', true, 'noSubs'),
      playColumn('second', true),
    ]);
  });

  it('under a resultRecorded card every action is disabled', () => {
    const board = footballBoard(displayOf(KICK_OFF), { kind: 'resultRecorded', undoLeft: 30 });
    expect(actionsOf(board)).toEqual([playColumn('first', false), playColumn('second', false)]);
  });

  it('before the start and once decided, nothing is live', () => {
    expect(actionsOf(footballBoard(displayOf([]), null))).toEqual([
      playColumn('first', false),
      playColumn('second', false),
    ]);
    const fullTime = [
      ...KICK_OFF,
      period('HT', at('H1', 2700)),
      clock(true, at('H2', 0)),
      period('FT', at('H2', 2700)),
    ];
    expect(actionsOf(footballBoard(displayOf(fullTime, withCfg(MATCH, LEAGUE_11)), null))).toEqual([
      playColumn('first', false),
      playColumn('second', false),
    ]);
  });

  it('marks each player in the bin by shirt number, with when the bin is over', () => {
    const binned = [...KICK_OFF, sinBin({ by: 'A', person: A(6), at: at('H1', 600) })];
    const board = footballBoard(displayOf(binned), null);
    expect(board.columns.map((column) => column.bins)).toEqual([
      [],
      [{ label: '#6', over: at('H1', 1200) }],
    ]);
  });
});

const kickColumn = (side: 'first' | 'second', enabled: boolean) => [
  button(`scored.${side}`, 'scored', enabled),
  button(`missed.${side}`, 'missed', enabled),
];

describe('footballBoard: the shootout (design §6.5)', () => {
  it('the columns read Scored and Missed, and only the kicking column is enabled', () => {
    const board = footballBoard(displayOf(KICKS_4_3), null);
    expect(actionsOf(board)).toEqual([kickColumn('first', false), kickColumn('second', true)]);
    expect(board.kicks).toEqual([
      [true, true, true, true],
      [true, true, true],
    ]);
  });

  it('after away kicks, home is the kicking column', () => {
    const board = footballBoard(displayOf([...LEVEL_AFTER_ET, ...kicks('A-')]), null);
    expect(actionsOf(board)).toEqual([kickColumn('first', true), kickColumn('second', false)]);
    expect(board.kicks).toEqual([[], [false]]);
  });

  it('before the first kick either team may open: the engine names nobody', () => {
    const board = footballBoard(displayOf(LEVEL_AFTER_ET), null);
    expect(actionsOf(board)).toEqual([kickColumn('first', true), kickColumn('second', true)]);
    expect(board.kicks).toEqual([[], []]);
  });

  it('a shootout that decided the match keeps its columns, all off', () => {
    const board = footballBoard(displayOf(KICKS_4_1), null);
    expect(actionsOf(board)).toEqual([kickColumn('first', false), kickColumn('second', false)]);
  });
});

describe('parseFootballAction', () => {
  it.each([
    ['goal.first', { action: 'goal', side: 'first' }],
    ['card.second', { action: 'card', side: 'second' }],
    ['sub.first', { action: 'sub', side: 'first' }],
    ['scored.second', { action: 'scored', side: 'second' }],
    ['missed.first', { action: 'missed', side: 'first' }],
  ])('reads %s', (id, parsed) => {
    expect(parseFootballAction(id)).toEqual(parsed);
  });

  it.each(['goal', 'goal.third', 'kick.first', 'goal.first.0', '', 'more'])(
    'reads %j as no button of the board',
    (id) => {
      expect(parseFootballAction(id)).toBeNull();
    },
  );
});

const item = (id: string, word: string, vars?: Readonly<Record<string, string>>) => ({
  id,
  label: { key: `scoring.football.more.${word}`, ...(vars === undefined ? {} : { vars }) },
});

describe('footballMoreItems (design §6.4)', () => {
  it('in play: penalty, sin-bin and shot for each team, Correct clock and Match details', () => {
    expect(footballMoreItems(displayOf(KICK_OFF))).toEqual([
      item('penalty.first', 'penalty', { team: 'Home FC' }),
      item('penalty.second', 'penalty', { team: 'Away FC' }),
      item('sinBin.first', 'sinBin', { team: 'Home FC' }),
      item('sinBin.second', 'sinBin', { team: 'Away FC' }),
      item('shot.first', 'shot', { team: 'Home FC' }),
      item('shot.second', 'shot', { team: 'Away FC' }),
      item('correct', 'correct'),
      item('details', 'details'),
    ]);
  });

  it('sin-bin items are absent without sinBinMinutes', () => {
    const ids = footballMoreItems(displayOf(KICK_OFF, withCfg(MATCH, LEAGUE_11))).map((i) => i.id);
    expect(ids).toEqual([
      'penalty.first',
      'penalty.second',
      'shot.first',
      'shot.second',
      'correct',
      'details',
    ]);
  });

  it('one Back item per binned player, named as the sheets name him', () => {
    const binned = [
      ...KICK_OFF,
      sinBin({ by: 'A', person: A(6), at: at('H1', 600) }),
      sinBin({ by: 'A', person: A(9), at: at('H1', 650) }),
    ];
    const backs = footballMoreItems(displayOf(binned)).filter((i) => i.id.startsWith('sinBinEnd'));
    expect(backs).toEqual([
      item('sinBinEnd.second.0', 'sinBinEnd', { player: '#6 Away Player 6' }),
      item('sinBinEnd.second.1', 'sinBinEnd', { player: '#9 Away Player 9' }),
    ]);
  });

  it('before kick-off and in the shootout, only what the engine takes there: Match details', () => {
    expect(footballMoreItems(displayOf([]))).toEqual([item('details', 'details')]);
    expect(footballMoreItems(displayOf(KICKS_4_3))).toEqual([item('details', 'details')]);
  });

  // The engine empties the bin when a period ends, but an abandoned match keeps whoever was in it: Back from sin-bin is
  // offered only where the engine takes it, never for a match that is over.
  it('an abandoned match with a player in the bin offers no Back from sin-bin', () => {
    const abandoned = displayOf([
      ...KICK_OFF,
      sinBin({ by: 'H', person: H(6), at: at('H1', 600) }),
      { type: 'core.abandon', payload: { reason: 'weather' } },
    ]);
    expect(abandoned.sides.first.sinBin).toHaveLength(1);
    expect(footballMoreItems(abandoned)).toEqual([item('details', 'details')]);
  });
});

const bar = (
  time: string,
  period: string | null,
  action: 'start' | 'pause' | null,
): ClockBarView<string> => ({
  time,
  period: period === null ? null : { key: `scoring.football.${period}` },
  said: { key: 'scoring.football.clock.said', vars: { time } },
  action:
    action === null ? null : { kind: action, label: { key: `scoring.football.clock.${action}` } },
});

describe('footballClockBar (design §6.1, §7.4)', () => {
  it('reads the first half running, with Pause', () => {
    expect(footballClockBar(displayOf(KICK_OFF), 754)).toEqual(bar('12:34', 'period.H1', 'pause'));
  });

  it('the clock bar reads Half-time and 45:00 after HT, with Start', () => {
    const halfTime = [...KICK_OFF, period('HT', at('H1', 2760))];
    expect(footballClockBar(displayOf(halfTime), 0)).toEqual(
      bar('45:00', 'break.halfTime', 'start'),
    );
  });

  it('reads 90+2:30 in added time, and 2nd half once the clock starts again', () => {
    const second = [...KICK_OFF, period('HT', at('H1', 2700)), clock(true, at('H2', 0))];
    expect(footballClockBar(displayOf(second), 2850)).toEqual(bar('90+2:30', 'period.H2', 'pause'));
  });

  it('names a match of quarters by quarter: 1st quarter, then Quarter-time', () => {
    const mini = withCfg(MATCH, MINI);
    expect(footballClockBar(displayOf(KICK_OFF, mini), 65)).toEqual(
      bar('1:05', 'period.Q1', 'pause'),
    );
    const ended = [...KICK_OFF, period('QT', at('H1', 600))];
    expect(footballClockBar(displayOf(ended, mini), 0)).toEqual(
      bar('10:00', 'break.quarterTime', 'start'),
    );
  });

  it('reads Extra time half-time after ET_HT', () => {
    const etBreak = LEVEL_AFTER_ET.slice(0, -2);
    expect(footballClockBar(displayOf(etBreak), 0)).toEqual(
      bar('105:00', 'break.etHalfTime', 'start'),
    );
  });

  it('a paused clock offers Start', () => {
    const paused = [...KICK_OFF, clock(false, at('H1', 300))];
    expect(footballClockBar(displayOf(paused), 300)).toEqual(bar('5:00', 'period.H1', 'start'));
  });

  it('before the start: 0:00, no period, no button', () => {
    expect(footballClockBar(displayOf([]), 0)).toEqual(bar('0:00', null, null));
    expect(footballClockBar(displayOf([start()]), 0)).toEqual(bar('0:00', 'period.H1', 'start'));
  });

  it('in the shootout: Penalties, no button, the face where the last whistle left it', () => {
    expect(footballClockBar(displayOf(KICKS_4_3), 0)).toEqual(
      bar('120:00', 'period.shootout', null),
    );
  });

  it('at full time: Full time, no button', () => {
    const fullTime = [
      ...KICK_OFF,
      period('HT', at('H1', 2700)),
      clock(true, at('H2', 0)),
      period('FT', at('H2', 2880)),
    ];
    expect(footballClockBar(displayOf(fullTime, withCfg(MATCH, LEAGUE_11)), 0)).toEqual(
      bar('90+3:00', 'break.fullTime', null),
    );
  });

  it('reads the design’s words from the dictionary', () => {
    const word = (key: MessageKey) => en[key];
    expect(word('scoring.football.break.halfTime')).toBe('Half-time');
    expect(word('scoring.football.period.H1')).toBe('1st half');
    expect(word('scoring.football.period.ET_H1')).toBe('Extra time 1st half');
    expect(word('scoring.football.column.noSubs')).toBe('No subs left');
    expect(word('scoring.football.column.noSheet')).toBe('No team sheet');
    expect(word('scoring.football.clock.start')).toBe('Start');
    expect(word('scoring.football.clock.pause')).toBe('Pause');
  });
});

// What the pad reads of the board (plan P Task 11): what it offers but must not decide. Expected values from the design.
describe('what the pad reads of the board', () => {
  it('Correct is offered while a period is in play, at the break (the engine is in the next period) and not once over', () => {
    expect(footballTakesCorrect(displayOf(KICK_OFF))).toBe(true);
    expect(footballTakesCorrect(displayOf([...KICK_OFF, period('HT', at('H1', 2700))]))).toBe(true);
    expect(footballTakesCorrect(displayOf([start()]))).toBe(true);
    expect(footballTakesCorrect(displayOf(KICKS_4_1))).toBe(false);
  });
});

// The pad screen's small readers (plan P Task 12): what it draws but must not decide. Expected values from the design.
describe('what the pad screen reads of the board', () => {
  it('the leading side is the one with more goals; level, the one with more kicks scored; level and no kicks, neither', () => {
    const homeAhead = displayOf([...KICK_OFF, goal({ by: 'H', at: at('H1', 60) })]);
    expect([footballLeads(homeAhead, 'first'), footballLeads(homeAhead, 'second')]).toEqual([
      true,
      false,
    ]);
    const level = displayOf(KICK_OFF);
    expect([footballLeads(level, 'first'), footballLeads(level, 'second')]).toEqual([false, false]);
    const kicked = displayOf(KICKS_4_1);
    expect([footballLeads(kicked, 'first'), footballLeads(kicked, 'second')]).toEqual([
      true,
      false,
    ]);
  });

  it('a sin-bin is over once the reading reaches its end in its period, or in any later period', () => {
    const end = { period: 'H1', elapsed: 1200 };
    expect(binOver(end, { period: 'H1', elapsed: 1199 })).toBe(false);
    expect(binOver(end, { period: 'H1', elapsed: 1200 })).toBe(true);
    expect(binOver(end, { period: 'H2', elapsed: 0 })).toBe(true);
    expect(binOver({ period: 'H2', elapsed: 60 }, { period: 'H1', elapsed: 2800 })).toBe(false);
    expect(binOver(null, { period: 'ET_H2', elapsed: 900 })).toBe(false);
  });

  it('Correct’s time is counted the way the match counts, and never below the period’s start', () => {
    const second = displayOf([...KICK_OFF, period('HT', at('H1', 2700)), clock(true, at('H2', 0))]);
    expect(footballCorrectTime(second, 600)).toBe('55:00');
    expect(footballCorrectTime(second, -30)).toBe('45:00');
    expect(footballCorrectTime(displayOf(KICK_OFF), 2760)).toBe('45+1:00');
  });
});
