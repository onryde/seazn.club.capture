import { describe, expect, it } from 'vitest';
import { footballCfg } from '@/domain/scoring/footballEngine';
import {
  doneSaid,
  footballHistory,
  periodWordOf,
  undoneSaid,
  type FootballWords,
} from '@/domain/scoring/footballHistory';
import type { FootballDone, FootballPlayer } from '@/domain/scoring/footballTypes';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import {
  at,
  card,
  clock,
  eventId,
  goal,
  KO_11,
  MATCH,
  MINI,
  period,
  queuedOf,
  sub,
  voiding,
  withCfg,
} from '../../../test/footballLedger';
import {
  H,
  A,
  historyOf,
  KICK_OFF,
  kicks,
  LEVEL_AFTER_ET,
} from '../../../test/footballPadFixtures';

/**
 * Football's words and History (S2-5 design §6.4, §6.7; S2 ruling 21; plan P Task 8). The lines the design gives are
 * written out as it gives them; the keys come from the dictionary.
 */

const english = createTranslator('en');
const say = (text: Parameters<typeof translatePad>[1]) => translatePad(english, text);

const cfg = footballCfg(KO_11);
if (cfg === null) throw new Error('KO_11 does not parse');
const WORDS: FootballWords = { names: { first: 'Riverside', second: 'Northgate' }, cfg };

const player = (personId: string, name: string, number: number | null): FootballPlayer => ({
  personId,
  name,
  number,
});
const SILVA = player('p-silva', 'Silva', 10);
const STAMP_41 = at('H1', 2410);

describe('doneSaid: the last-tap line’s words (design §6.7)', () => {
  it.each<[string, FootballDone, string]>([
    ['the start', { kind: 'start' }, 'Match started'],
    ['a Start', { kind: 'clock', running: true, at: at('H2', 0) }, 'Clock started · 45:00'],
    ['a Pause', { kind: 'clock', running: false, at: at('H1', 754) }, 'Clock paused · 12:34'],
    ['a Pause with no stamp', { kind: 'clock', running: false, at: null }, 'Clock paused'],
    // The controller's fix-round 2 ruling: a correction is said as a record, "Clock corrected", not in Correct's button words.
    ['a correction', { kind: 'clockCorrect', at: at('H1', 120) }, 'Clock corrected · 2:00'],
    ['a correction with no stamp', { kind: 'clockCorrect', at: null }, 'Clock corrected'],
    [
      'a goal',
      { kind: 'goal', side: 'first', scorer: SILVA, ownGoal: false, penalty: false, at: STAMP_41 },
      "Goal · Riverside · #10 Silva 41'",
    ],
    [
      'a goal with no scorer and no stamp',
      { kind: 'goal', side: 'second', scorer: null, ownGoal: false, penalty: false, at: null },
      'Goal · Northgate',
    ],
    [
      'a penalty goal in added time',
      {
        kind: 'goal',
        side: 'first',
        scorer: SILVA,
        ownGoal: false,
        penalty: true,
        at: at('H2', 2850),
      },
      "Penalty goal · Riverside · #10 Silva 90+3'",
    ],
    [
      'an own goal, credited to the team it counts for',
      {
        kind: 'goal',
        side: 'first',
        scorer: player('p-4', 'Okafor', 4),
        ownGoal: true,
        penalty: false,
        at: STAMP_41,
      },
      "Goal · Riverside · own goal · #4 Okafor 41'",
    ],
    // The console can set both toggles; the engine counts such a goal as an own goal, never a penalty goal (its stats'
    // penalty-goal count is `penalty && !ownGoal`), so the line says the own goal.
    [
      'an own goal from a penalty is said as an own goal',
      {
        kind: 'goal',
        side: 'first',
        scorer: player('p-4', 'Okafor', 4),
        ownGoal: true,
        penalty: true,
        at: STAMP_41,
      },
      "Goal · Riverside · own goal · #4 Okafor 41'",
    ],
    [
      'a sub',
      {
        kind: 'sub',
        side: 'second',
        off: player('p-8', 'Bloggs', 8),
        on: player('p-14', 'Jones', 14),
        at: at('H2', 930),
      },
      "Sub · Northgate · #8 off, #14 on 61'",
    ],
    [
      'a sub of players with no shirt number',
      {
        kind: 'sub',
        side: 'second',
        off: player('p-8', 'Bloggs', null),
        on: player('p-14', 'Jones', null),
        at: null,
      },
      'Sub · Northgate · Bloggs off, Jones on',
    ],
    [
      'a card',
      { kind: 'card', side: 'second', color: 'second_yellow', person: SILVA, at: at('H1', 600) },
      "Second yellow · Northgate · #10 Silva 11'",
    ],
    ['a whistle', { kind: 'period', marker: 'HT', at: at('H1', 2760) }, "Half-time 45+2'"],
    [
      'a missed penalty',
      { kind: 'penaltyMiss', side: 'first', taker: SILVA, outcome: 'post', at: STAMP_41 },
      "Missed penalty · Riverside · #10 Silva · Hit the post 41'",
    ],
    [
      'a sin-bin',
      { kind: 'sinBin', side: 'first', person: SILVA, at: STAMP_41 },
      "Sin-bin · Riverside · #10 Silva 41'",
    ],
    [
      'a return from the bin',
      { kind: 'sinBinEnd', side: 'first', person: null, at: null },
      'Back from sin-bin · Riverside',
    ],
    [
      'a shot',
      { kind: 'shot', side: 'second', taker: null, outcome: 'blocked', at: STAMP_41 },
      "Shot · Northgate · Blocked 41'",
    ],
    [
      'a kick scored',
      { kind: 'kick', side: 'first', person: SILVA, scored: true },
      'Kick scored · Riverside · #10 Silva',
    ],
    [
      'a kick missed',
      { kind: 'kick', side: 'second', person: null, scored: false },
      'Kick missed · Northgate',
    ],
  ])('%s', (_name, did, line) => {
    expect(say(doneSaid(WORDS, did))).toBe(line);
  });

  it('an engine word this build has no words for is said as the engine says it', () => {
    const blue: FootballDone = {
      kind: 'card',
      side: 'first',
      color: 'blue',
      person: null,
      at: null,
    };
    expect(say(doneSaid(WORDS, blue))).toBe('blue · Riverside');
  });

  it('an undone event: Undone, then the event', () => {
    expect(say(undoneSaid(WORDS, { kind: 'start' }))).toBe('Undone — Match started');
  });

  it('every kind’s words are in all four languages', () => {
    const lines: FootballDone[] = [
      { kind: 'start' },
      { kind: 'clock', running: true, at: null },
      { kind: 'clock', running: false, at: null },
      { kind: 'clockCorrect', at: null },
      { kind: 'goal', side: 'first', scorer: null, ownGoal: false, penalty: false, at: null },
      { kind: 'goal', side: 'first', scorer: null, ownGoal: true, penalty: false, at: null },
      { kind: 'goal', side: 'first', scorer: null, ownGoal: false, penalty: true, at: null },
      ...(['yellow', 'second_yellow', 'red'] as const).map((color): FootballDone => ({
        kind: 'card',
        side: 'first',
        color,
        person: null,
        at: null,
      })),
      { kind: 'sub', side: 'first', off: SILVA, on: SILVA, at: null },
      ...['HT', 'FT', 'QT', '3QT', 'ET_HT', 'ET_FT'].map((marker): FootballDone => ({
        kind: 'period',
        marker,
        at: null,
      })),
      ...(['saved', 'missed', 'post'] as const).map((outcome): FootballDone => ({
        kind: 'penaltyMiss',
        side: 'first',
        taker: null,
        outcome,
        at: null,
      })),
      ...(['saved', 'missed', 'blocked', 'scored'] as const).map((outcome): FootballDone => ({
        kind: 'shot',
        side: 'first',
        taker: null,
        outcome,
        at: null,
      })),
      { kind: 'sinBin', side: 'first', person: null, at: null },
      { kind: 'sinBinEnd', side: 'first', person: null, at: null },
      { kind: 'kick', side: 'first', person: null, scored: true },
      { kind: 'kick', side: 'first', person: null, scored: false },
    ];
    const keys = new Set(
      JSON.stringify(lines.map((did) => undoneSaid(WORDS, did))).match(
        /scoring\.football\.[\w.]+/g,
      ),
    );
    for (const dictionary of [en, es, fr, nl] as Readonly<Record<string, string>>[]) {
      expect([...keys].filter((key) => !(key in dictionary))).toEqual([]);
    }
  });
});

describe('periodWordOf', () => {
  it('names the engine’s phases, the first quarter in a match of quarters, the kicks; none before or after play', () => {
    const mini = footballCfg(MINI);
    if (mini === null) throw new Error('MINI does not parse');
    expect(
      ['H1', 'H2', 'ET_H1', 'ET_H2', 'SHOOTOUT', 'pre', 'done'].map((p) => periodWordOf(p, cfg)),
    ).toEqual(['H1', 'H2', 'ET_H1', 'ET_H2', 'shootout', null, null]);
    expect(['H1', 'Q2', 'Q3', 'Q4'].map((p) => periodWordOf(p, mini))).toEqual([
      'Q1',
      'Q2',
      'Q3',
      'Q4',
    ]);
  });
});

const row = (
  said: string,
  score: string | null,
  more: { readonly own?: boolean; readonly undone?: boolean; readonly sending?: boolean } = {},
) => ({
  said,
  score,
  by: more.own === true ? 'thisPhone' : 'otherScorer',
  undone: more.undone ?? false,
  sending: more.sending ?? false,
});

/** History as the scorer reads it: each heading and row in English. */
const read = (groups: ReturnType<typeof historyOf>) =>
  groups.map((group) => ({
    heading: say(group.heading),
    rows: group.rows.map((r) => ({ ...r, said: say(r.said) })),
  }));

describe('footballHistory (S2 ruling 21; design §6.4)', () => {
  it("History groups by period, newest first, with 41'", () => {
    const match = [
      ...KICK_OFF,
      goal({ by: 'H', scorer: H(9), at: at('H1', 2410) }),
      period('HT', at('H1', 2760)),
      clock(true, at('H2', 0)),
      card({ by: 'A', color: 'yellow', person: A(5), at: at('H2', 600) }),
      goal({ by: 'A', at: at('H2', 900) }),
    ];
    expect(read(historyOf(match))).toEqual([
      {
        heading: '2nd half',
        rows: [
          row("Goal · Away FC 61'", '1–1'),
          row("Yellow card · Away FC · #5 Away Player 5 56'", null),
          row('Clock started · 45:00', null),
        ],
      },
      {
        heading: '1st half',
        rows: [
          row("Half-time 45+2'", null),
          row("Goal · Home FC · #9 Home Player 9 41'", '1–0'),
          row('Clock started · 0:00', null),
          row('Match started', null),
        ],
      },
    ]);
  });

  it('an own goal’s score is the team it counts for', () => {
    const own = [...KICK_OFF, goal({ by: 'A', ownGoal: true, scorer: A(4), at: at('H1', 600) })];
    expect(read(historyOf(own))[0]?.rows[0]).toEqual(
      row("Goal · Home FC · own goal · #4 Away Player 4 11'", '1–0'),
    );
  });

  it('an entry Undo took back stays in its place, struck; the void is no row', () => {
    const undone = [...KICK_OFF, goal({ by: 'H', at: at('H1', 600) }), voiding(eventId(3))];
    const groups = read(historyOf(undone, MATCH, { ownEventIds: [eventId(3), eventId(4)] }));
    expect(groups).toEqual([
      {
        heading: '1st half',
        rows: [
          row("Goal · Home FC 11'", '1–0', { own: true, undone: true }),
          row('Clock started · 0:00', null),
          row('Match started', null),
        ],
      },
    ]);
  });

  it('this phone’s queued tap is on top, sending', () => {
    const queued = [queuedOf('k1', sub({ by: 'H', off: H(8), on: H(14) }))];
    const groups = read(historyOf(KICK_OFF, MATCH, { queued }));
    expect(groups[0]?.rows[0]).toEqual(
      row('Sub · Home FC · #8 off, #14 on', null, { own: true, sending: true }),
    );
  });

  it('the kicks are their own group, Penalties, with no score on a kick', () => {
    const groups = read(historyOf([...LEVEL_AFTER_ET, ...kicks('H+ A-')]));
    expect(groups.map((group) => group.heading)).toEqual([
      'Penalties',
      'Extra time 2nd half',
      'Extra time 1st half',
      '2nd half',
      '1st half',
    ]);
    expect(groups[0]?.rows).toEqual([
      row('Kick missed · Away FC', null),
      row('Kick scored · Home FC', null),
    ]);
  });

  it('a match of quarters heads its first period 1st quarter', () => {
    expect(read(historyOf(KICK_OFF, withCfg(MATCH, MINI))).map((group) => group.heading)).toEqual([
      '1st quarter',
    ]);
  });

  it('nothing recorded, no group', () => {
    expect(historyOf([])).toEqual([]);
    expect(footballHistory([], WORDS)).toEqual([]);
  });
});
