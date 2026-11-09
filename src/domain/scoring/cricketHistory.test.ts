import type { EventEnvelope } from '@seazn/engine/core';
import { cricket } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { foldCricket } from '@/domain/scoring/cricketFold';
import {
  doneSaid,
  EVENT_WORDS,
  historyDoneOf,
  undoneSaid,
  type CricketCoreType,
  type CricketDone,
  type CricketWords,
} from '@/domain/scoring/cricketHistory';
import type { CricketBallTap, CricketTap } from '@/domain/scoring/cricketTypes';
import type { PadHistoryGroup } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { Bootstrap } from '@/domain/scoring/wire';
import { seatsOf } from '@/domain/scoring/setBasedSides';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import {
  FIRST_INNINGS_8,
  MATCH,
  NO_AWAY_PLAYERS,
  ONE,
  OPENING,
  TIED_KO,
  TWO_INNINGS,
  ball,
  declare,
  eventId,
  ledgerOf,
  player,
  queuedOf,
  start,
  summary,
  superOverOf,
  toss,
  voiding,
  withCfg,
  type Spec,
} from '../../../test/cricketLedger';

// What a cricket event did, in the pad's words (S2-4 spec §4.7, §6; plan Task 7), and History from the ledger: the
// innings each event belongs to, newest first, an event Undo took back struck in its place. Every sentence is written out.

const H = (n: number) => player('H', n);
const A = (n: number) => player('A', n);

const SIDES = {
  first: { name: 'Home CC', entrantId: 'ent-home' },
  second: { name: 'Away CC', entrantId: 'ent-away' },
} as const;

const NAMES = new Map(
  Array.from({ length: 11 }, (_, i) => i + 1).flatMap((n) => [
    [H(n), `Home Player ${n}`] as const,
    [A(n), `Away Player ${n}`] as const,
  ]),
);

const WORDS: CricketWords = { names: NAMES, sides: SIDES, ballsPerOver: 6 };

type Lang = 'en' | 'es' | 'fr' | 'nl';

const say = (lang: Lang, did: CricketDone) =>
  translatePad(createTranslator(lang), doneSaid(did, WORDS));

const delivery = (ball: Partial<CricketBallTap>): CricketTap => ({
  kind: 'ball',
  ball: { bat: 0, extra: null, boundary: null, wicket: null, ...ball },
});

const wicket = (over: Partial<NonNullable<CricketBallTap['wicket']>>) => ({
  kind: 'bowled' as const,
  out: H(1),
  fielder: null,
  fielderAssist: null,
  incoming: null,
  ...over,
});

describe('the words, in English and in Dutch', () => {
  it('a wide with two run is three wides', () => {
    const wide = delivery({ extra: { kind: 'wide', runs: 3 } });
    expect(say('en', wide)).toBe('3 wides');
    expect(say('nl', wide)).toBe('3 wides');
    expect(say('en', delivery({ extra: { kind: 'wide', runs: 1 } }))).toBe('Wide');
  });

  it('a caught names its fielder', () => {
    const caught = delivery({ wicket: wicket({ kind: 'caught', fielder: A(5) }) });
    expect(say('en', caught)).toBe('Home Player 1 out · caught (Away Player 5)');
    expect(say('nl', caught)).toBe('Home Player 1 uit · caught (Away Player 5)');
  });

  it('a retirement names the batter and why', () => {
    const hurt: CricketTap = { kind: 'retire', person: H(3), reason: 'hurt', incoming: H(5) };
    expect(say('en', hurt)).toBe('Home Player 3 retired hurt');
    expect(say('nl', hurt)).toBe('Home Player 3 trekt zich geblesseerd terug');
    expect(say('en', { kind: 'retire', person: H(3), reason: 'out', incoming: null })).toBe(
      'Home Player 3 retired out',
    );
    expect(say('en', { kind: 'retire', person: H(3), reason: 'other', incoming: null })).toBe(
      'Home Player 3 retired',
    );
  });

  it('a change of bowler names the new one', () => {
    const change: CricketTap = { kind: 'bowlerChange', bowler: A(9), reason: 'incapacitated' };
    expect(say('en', change)).toBe('New bowler: Away Player 9');
    expect(say('nl', change)).toBe('Nieuwe bowler: Away Player 9');
    expect(say('fr', change)).toBe(`Nouveau lanceur${String.fromCodePoint(0xa0)}: Away Player 9`);
  });
});

describe('a ball, in words', () => {
  it('a dot, runs, a four and a six; an all-run four is four runs', () => {
    expect(say('en', delivery({}))).toBe('Dot ball');
    expect(say('en', delivery({ bat: 1 }))).toBe('1 run');
    expect(say('en', delivery({ bat: 3 }))).toBe('3 runs');
    expect(say('en', delivery({ bat: 4, boundary: 4 }))).toBe('Four');
    expect(say('en', delivery({ bat: 6, boundary: 6 }))).toBe('Six');
    expect(say('en', delivery({ bat: 4 }))).toBe('4 runs');
  });

  it('an extra first, then the runs off the bat, then the dismissal', () => {
    const noBallSix = delivery({ bat: 6, boundary: 6, extra: { kind: 'noball', runs: 1 } });
    expect(say('en', noBallSix)).toBe('No-ball, Six');
    expect(say('en', delivery({ extra: { kind: 'bye', runs: 2 } }))).toBe('2 byes');
    expect(say('en', delivery({ extra: { kind: 'legbye', runs: 1 } }))).toBe('1 leg-bye');
    expect(say('en', delivery({ bat: 1, extra: { kind: 'penalty', runs: 5 } }))).toBe(
      '5 penalty runs, 1 run',
    );
    const runOut = wicket({ kind: 'runout', out: H(2), fielder: A(4), fielderAssist: A(2) });
    expect(say('en', delivery({ bat: 1, wicket: runOut }))).toBe(
      '1 run, Home Player 2 out · run out (Away Player 2/Away Player 4)',
    );
    expect(say('en', delivery({ wicket: wicket({}) }))).toBe('Home Player 1 out · bowled');
  });

  it('a name no team sheet holds is said by its id', () => {
    expect(say('en', delivery({ wicket: wicket({ out: 'P-unknown' }) }))).toBe(
      'P-unknown out · bowled',
    );
  });
});

describe('the other taps', () => {
  it('the toss, the start, over totals and an Undo', () => {
    expect(say('en', { kind: 'toss', wonBy: 'second', elected: 'bowl' })).toBe(
      'Away CC won the toss and chose to bowl',
    );
    expect(say('nl', { kind: 'toss', wonBy: 'first', elected: 'bat' })).toBe(
      'Home CC won de toss: batten',
    );
    expect(say('en', { kind: 'start' })).toBe('Match started');
    expect(say('en', { kind: 'summary', runs: 14, wickets: 1, legalBalls: 12 })).toBe(
      'Over recorded · 14/1 (2 ov)',
    );
    expect(say('en', { kind: 'summary', runs: 9, wickets: 0, legalBalls: 11 })).toBe(
      'Over recorded · 9/0 (1.5 ov)',
    );
    const undone = translatePad(createTranslator('en'), undoneSaid(delivery({ bat: 2 }), WORDS));
    expect(undone).toBe('Undone — 2 runs');
  });

  it('a More item is said by its type', () => {
    expect(say('en', { kind: 'more', type: 'cricket.innings.declare', payload: {} })).toBe(
      'Innings declared',
    );
    expect(say('nl', { kind: 'more', type: 'cricket.newball', payload: {} })).toBe(
      'Nieuwe bal genomen',
    );
  });

  // Batch 4 review M5: "Target revised" was untrue of a revision of the overs alone, and the payload is to hand.
  it.each([
    ['en', 'Target revised', 'Overs revised'],
    ['es', 'Objetivo revisado', 'Overs revisados'],
    ['fr', 'Objectif révisé', 'Overs révisés'],
    ['nl', 'Doel herzien', 'Overs herzien'],
  ] as const)(
    '%s: a revision says what it revised: the target, or the overs alone',
    (lang, target, overs) => {
      const revise = (payload: unknown) =>
        say(lang, { kind: 'more', type: 'cricket.revise', payload });
      expect(revise({ target: 41 })).toBe(target);
      expect(revise({ oversPerSide: 15 })).toBe(overs);
      // Both: a target was set, so the target is what changed the chase.
      expect(revise({ oversPerSide: 15, target: 120 })).toBe(target);
      // A payload the pad cannot read, or one that names neither, keeps the type's own words.
      expect(revise({ unread: true })).toBe(target);
      expect(revise({})).toBe(target);
    },
  );

  it('only a revision is read for what it revised: another type with such a payload keeps its own words', () => {
    expect(
      say('en', { kind: 'more', type: 'cricket.interruption', payload: { oversPerSide: 15 } }),
    ).toBe('Interruption recorded');
  });
});

/** An envelope of `type` whose payload no tap of the pad's reads back. */
const unread = (type: string): EventEnvelope => ({
  id: `ev-${type}`,
  fixtureId: 'fx-cricket-1',
  seq: 1,
  type,
  payload: { unread: true },
  recordedAt: '2026-11-07T10:00:00.000Z',
  recordedBy: null,
});

const SEATS = seatsOf(MATCH);

describe('every event has words', () => {
  // Preflight F21: the console records types the phone never sends (cricket.player.line), and History lists them too.
  // A payload no tap reads back (as the console might write it) still has its type's words: the web's ribbon words.
  const RIBBON: Readonly<Record<string, string>> = {
    'cricket.toss': 'Toss recorded',
    'cricket.ball': 'Ball recorded',
    'cricket.superover.ball': 'Super over ball recorded',
    'cricket.innings.summary': 'Over recorded',
    'cricket.innings.declare': 'Innings declared',
    'cricket.innings.close': 'Innings closed',
    'cricket.match.close': 'Match closed',
    'cricket.interruption': 'Interruption recorded',
    'cricket.revise': 'Target revised',
    'cricket.followon': 'Follow-on enforced',
    'cricket.player.line': 'Scorecard line recorded',
    'cricket.retire': 'Retirement recorded',
    'cricket.newball': 'New ball taken',
    'cricket.powerplay': 'Powerplay recorded',
    'cricket.review': 'Review recorded',
    'cricket.bowler.change': 'Bowler changed',
  };

  it('every cricket event type has History words', () => {
    if (SEATS === null) throw new Error('no seats');
    const types = Object.keys(cricket.eventSchemas ?? {});
    let swept = 0;
    for (const type of types) {
      const did = historyDoneOf(unread(type), SEATS);
      const words =
        did === null ? null : translatePad(createTranslator('en'), doneSaid(did, WORDS));
      expect({ type, words }).toStrictEqual({ type, words: RIBBON[type] });
      swept += 1;
    }
    expect(swept).toBe(types.length);
    expect(swept).toBe(16);
  });

  it('the kernel’s types a ledger can hold have words; a void and an unknown type have no row', () => {
    if (SEATS === null) throw new Error('no seats');
    const core: readonly CricketCoreType[] = [
      'core.forfeit',
      'core.abandon',
      'core.finalize',
      'core.note',
      'core.award',
      'core.suspend',
      'core.resume',
      'core.settle',
      'core.lineup.substitution',
      'core.lineup.replacement',
      'core.lineup.position',
      'core.lineup.retirement',
      'core.lineup.entry',
    ];
    expect(core.map((type) => historyDoneOf(unread(type), SEATS))).toStrictEqual(
      core.map((type) => ({ kind: 'event', type })),
    );
    expect(Object.keys(EVENT_WORDS)).toHaveLength(16 + core.length);
    expect(say('en', { kind: 'event', type: 'core.lineup.entry' })).toBe('Team sheet changed');
    expect(historyDoneOf(unread('core.start'), SEATS)).toStrictEqual({ kind: 'start' });
    expect(historyDoneOf(unread('core.void'), SEATS)).toBeNull();
    expect(historyDoneOf(unread('tennis.point'), SEATS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// History from the ledger
// ---------------------------------------------------------------------------------------------------------------

function historyOf(
  specs: readonly Spec[],
  own: readonly number[] = [],
  queued: readonly QueuedEvent[] = [],
  bootstrap: Bootstrap = MATCH,
) {
  const folded = foldCricket({
    bootstrap,
    ledger: ledgerOf(specs),
    queued,
    ownEventIds: own.map(eventId),
    toss: null,
  });
  if (folded.kind !== 'folded') throw new Error('did not fold');
  return folded.history;
}

/** History in English: each group's heading and its rows' words, score, who, undone and sending. */
function read(history: readonly PadHistoryGroup<string>[]) {
  const t = createTranslator('en');
  return history.map((group) => ({
    heading: translatePad(t, group.heading as never),
    rows: group.rows.map((row) => [
      translatePad(t, row.said as never),
      row.score,
      row.by,
      row.undone,
      row.sending,
    ]),
  }));
}

const first = (n: number, more: object = {}) =>
  ball({ over: 0, ballInOver: n, striker: H(1), nonStriker: H(2), bowler: A(11), ...more });

describe('History', () => {
  it('nothing recorded, no group', () => {
    expect(historyOf([])).toStrictEqual([]);
  });

  it('the toss and the start head the first innings; a ball gives the innings’ score after it', () => {
    expect(read(historyOf([...OPENING, first(1, { bat: 4, boundary: 4 })], [3]))).toStrictEqual([
      {
        heading: 'Innings 1 · Home CC',
        rows: [
          ['Four', '4/0', 'thisPhone', false, false],
          ['Match started', null, 'otherScorer', false, false],
          ['Home CC won the toss and chose to bat', null, 'otherScorer', false, false],
        ],
      },
    ]);
  });

  it('a ball Undo took back is struck in its place, with no score; the void is no row', () => {
    const history = read(historyOf([...OPENING, first(1, { bat: 2 }), voiding(3)], [3, 4]));
    expect(history[0]?.rows).toStrictEqual([
      ['2 runs', null, 'thisPhone', true, false],
      ['Match started', null, 'otherScorer', false, false],
      ['Home CC won the toss and chose to bat', null, 'otherScorer', false, false],
    ]);
  });

  it('the latest innings first: the second innings above the first', () => {
    const chase = ball({
      over: 0,
      ballInOver: 1,
      striker: A(1),
      nonStriker: A(2),
      bowler: H(11),
      bat: 1,
    });
    const history = read(historyOf([...FIRST_INNINGS_8, chase]));
    expect(history.map((group) => group.heading)).toStrictEqual([
      'Innings 2 · Away CC',
      'Innings 1 · Home CC',
    ]);
    expect(history[0]?.rows).toStrictEqual([['1 run', '1/0', 'otherScorer', false, false]]);
    expect(history[1]?.rows[0]).toStrictEqual(['Dot ball', '8/0', 'otherScorer', false, false]);
  });

  it('a super over heads History, above both main innings', () => {
    const history = read(historyOf([...TIED_KO, ...superOverOf('A', H(11), [ONE])]));
    expect(history.map((group) => group.heading)).toStrictEqual([
      'Super over 1 · Away CC',
      'Innings 2 · Away CC',
      'Innings 1 · Home CC',
    ]);
    expect(history[0]?.rows).toStrictEqual([['1 run', '1/0', 'otherScorer', false, false]]);
  });

  it('this phone’s queued tap is on top, sending', () => {
    const history = read(historyOf(OPENING, [], [queuedOf('q-1', first(1, { bat: 1 }))]));
    expect(history[0]?.rows[0]).toStrictEqual(['1 run', '1/0', 'thisPhone', false, true]);
  });

  it('a declaration is under the innings it closed, not the one it leads to', () => {
    const history = read(
      historyOf([...OPENING, first(1, { bat: 1 }), declare()], [], [], withCfg(MATCH, TWO_INNINGS)),
    );
    expect(history.map((group) => group.heading)).toStrictEqual(['Innings 1 · Home CC']);
    expect(history[0]?.rows[0]).toStrictEqual([
      'Innings declared',
      null,
      'otherScorer',
      false,
      false,
    ]);
  });

  it('over totals for a side with no players give the innings’ score', () => {
    const history = read(
      historyOf([toss('A', 'bat'), start(), summary(9, 0, 6)], [], [], NO_AWAY_PLAYERS),
    );
    expect(history[0]?.heading).toBe('Innings 1 · Away CC');
    expect(history[0]?.rows[0]).toStrictEqual([
      'Over recorded · 9/0 (1 ov)',
      '9/0',
      'otherScorer',
      false,
      false,
    ]);
  });

  it('an organiser’s note before the toss is before play', () => {
    const note: Spec = { type: 'core.note', payload: { text: 'Pitch inspection at 10:00' } };
    const history = read(historyOf([note, toss('H', 'bat')]));
    expect(history.map((group) => group.heading)).toStrictEqual([
      'Innings 1 · Home CC',
      'Before play',
    ]);
    expect(history[1]?.rows).toStrictEqual([['Note added', null, 'otherScorer', false, false]]);
  });
});
