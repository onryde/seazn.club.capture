import { describe, expect, it } from 'vitest';
import { footballPad, footballResultLine } from '@/domain/scoring/footballPad';
import type { PadView } from '@/domain/scoring/padView';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import type { MessageKey } from '@/i18n/messages';
import nl from '@/i18n/nl.json';
import {
  at,
  card,
  clock,
  eventId,
  goal,
  MATCH,
  MINI,
  period,
  queuedOf,
  start,
  voiding,
  withCfg,
  LEAGUE_11,
  type Spec,
} from '../../../test/footballLedger';
import {
  displayOf,
  H,
  KICK_OFF,
  KICKS_4_1,
  KICKS_4_3,
  LEVEL_AFTER_ET,
} from '../../../test/footballPadFixtures';

/**
 * Football on the pad (S2-5 design §6.2–§6.7; plan P Task 8). Every expected view is written out from the design and the
 * dictionary, never computed by the pad.
 */

const padOf = (...args: Parameters<typeof displayOf>) => footballPad(displayOf(...args));

const GOAL_AT_41 = [...KICK_OFF, goal({ by: 'H', scorer: H(9), at: at('H1', 2410) })];

/** The organiser abandons the match (weather): `core.abandon`, the engine's `abandoned`. */
const ABANDON: Spec = { type: 'core.abandon', payload: { reason: 'weather' } };

describe('footballPad: the halves (design §6.2)', () => {
  it('names each team, home on top with the lime bar, and shows its goals; no half takes a tap', () => {
    const [top, bottom] = padOf(GOAL_AT_41).halves;
    expect([top.label, top.value, top.bar, top.tappable]).toEqual(['Home FC', '1', 'lit', false]);
    expect([bottom.label, bottom.value, bottom.bar, bottom.tappable]).toEqual([
      'Away FC',
      '0',
      'dim',
      false,
    ]);
  });

  it('draws one caution per yellow and one dismissal per red, a second yellow a red, each said', () => {
    const booked = [
      ...KICK_OFF,
      card({ by: 'H', color: 'yellow', person: H(4) }),
      card({ by: 'H', color: 'yellow', person: H(6) }),
      card({ by: 'H', color: 'second_yellow', person: H(6) }),
    ];
    const [top, bottom] = padOf(booked).halves;
    expect(top.marks).toEqual({
      clock: false,
      cards: ['caution', 'caution', 'dismissal'],
      said: [
        { key: 'scoring.football.card.yellow' },
        { key: 'scoring.football.card.yellow' },
        { key: 'scoring.football.card.red' },
      ],
    });
    expect(bottom.marks).toEqual({ clock: false, cards: [], said: [] });
  });

  it('reads "5 (4)" in the shootout: the match score, then the kicks scored', () => {
    const [top, bottom] = padOf(KICKS_4_3).halves;
    expect([top.value, bottom.value]).toEqual(['5 (4)', '5 (3)']);
  });

  it('keeps no set boxes, serving plate, colour plate or action word: football has none', () => {
    const [top] = padOf(GOAL_AT_41).halves;
    expect([top.periods, top.sub, top.serving, top.plate, top.action]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('says the score with the names; the header draws none (it is in the halves)', () => {
    expect(padOf(GOAL_AT_41).tally).toEqual({
      shown: '',
      said: {
        key: 'scoring.football.tallySaid',
        vars: { first: 'Home FC', firstGoals: '1', second: 'Away FC', secondGoals: '0' },
      },
    });
  });
});

describe('footballPad: before the start, and no strip (design §6.7, ruling 146)', () => {
  it('asks to start with no toss before the match starts; the Start panel says so, no strip does', () => {
    const pad = padOf([]);
    expect(pad.start).toEqual({
      ask: { key: 'scoring.football.start.ask' },
      needsToss: false,
      sides: [
        { side: 'first', label: 'Home FC' },
        { side: 'second', label: 'Away FC' },
      ],
    });
    expect(pad.strip).toEqual([]);
  });

  it('has no Start screen once the match has started', () => {
    expect(padOf([start()]).start).toBeNull();
  });

  it('has no strip in any phase: normal time, extra time, the shootout and decided', () => {
    for (const specs of [GOAL_AT_41, LEVEL_AFTER_ET.slice(0, -1), LEVEL_AFTER_ET, KICKS_4_1])
      expect(padOf(specs).strip).toEqual([]);
  });

  it('carries the match and its rules into Match details', () => {
    const { details } = padOf(GOAL_AT_41);
    expect(details.context.competition).toBe('County Cup 2026');
    expect(details.rules[0]).toEqual({
      label: { key: 'scoring.football.rules.format' },
      value: { key: 'scoring.football.rules.periods', vars: { count: 2, minutes: 45 } },
    });
  });
});

const MORE = {
  id: 'more',
  label: { key: 'scoring.football.tool.more' },
  detail: null,
  kind: 'standard',
  enabled: true,
} as const;

const endOf = (marker: string) => ({
  id: 'period',
  label: { key: `scoring.football.end.${marker}` },
  detail: null,
  kind: 'standard',
  enabled: true,
});

describe('footballPad: the bottom row (design §6.4)', () => {
  it('before kick-off the row is More only', () => {
    expect(padOf([start()]).tools).toEqual([MORE]);
    expect(padOf([]).tools).toEqual([MORE]);
  });

  it('Half-time ends H1, End Q1 ends MINI’s first quarter', () => {
    expect(padOf(KICK_OFF).tools).toEqual([endOf('HT'), MORE]);
    expect(padOf(KICK_OFF, withCfg(MATCH, MINI)).tools).toEqual([endOf('QT'), MORE]);
  });

  it('offers End of period with no clock at all, once anything stands after the start', () => {
    expect(padOf([start(), goal({ by: 'A' })]).tools).toEqual([endOf('HT'), MORE]);
  });

  it('names what each whistle ends: Full time after half-time, End of extra time in its second half', () => {
    const second = [...KICK_OFF, period('HT', at('H1', 2700)), clock(true, at('H2', 0))];
    expect(padOf(second).tools).toEqual([endOf('FT'), MORE]);
    expect(padOf(LEVEL_AFTER_ET.slice(0, -1)).tools).toEqual([endOf('ET_FT'), MORE]);
  });

  it('the shootout row is More only', () => {
    expect(padOf(KICKS_4_3).tools).toEqual([MORE]);
  });
});

describe('footballPad: the last tap and the card', () => {
  it('says the last event with its minute, and offers Undo on this phone’s own', () => {
    const pad = padOf(GOAL_AT_41, MATCH, { ownEventIds: [eventId(3)] });
    expect(pad.lastTap?.undo).toBe(true);
    expect(pad.lastTap?.text).toEqual({
      key: 'scoring.football.last.goal',
      vars: { team: 'Home FC', who: ' · #9 Home Player 9', at: " 41'" },
    });
  });

  it('offers no Undo on another scorer’s event', () => {
    expect(padOf(GOAL_AT_41).lastTap?.undo).toBe(false);
  });

  it('says an undone event as undone, with no Undo', () => {
    const undone = [...GOAL_AT_41, voiding(eventId(3))];
    const pad = padOf(undone, MATCH, { ownEventIds: [eventId(3), eventId(4)] });
    expect(pad.lastTap).toEqual({
      text: {
        key: 'scoring.football.last.undone',
        vars: {
          what: {
            key: 'scoring.football.last.goal',
            vars: { team: 'Home FC', who: ' · #9 Home Player 9', at: " 41'" },
          },
        },
      },
      undo: false,
    });
  });

  // This phone's clock start still stands under the voided goal, so the match can Undo again; the undone line itself
  // offers none (as chess's does): the operator undoes from the Undo cell, not from a line that names what is gone.
  it('an undone line offers no Undo even while another of this phone’s events could be undone', () => {
    const undone = [...GOAL_AT_41, voiding(eventId(3))];
    const display = displayOf(undone, MATCH, { ownEventIds: [eventId(2), eventId(3), eventId(4)] });
    expect(display.undoable).toBe(true);
    expect(footballPad(display).lastTap?.undo).toBe(false);
  });

  it('a decided match is the recorded result over the score: nothing taps, no tools', () => {
    const pad = padOf(KICKS_4_1);
    expect(pad.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(pad.tools).toEqual([]);
    expect(pad.halves.map((half) => half.tappable)).toEqual([false, false]);
  });

  // An abandoned match decided nothing (the engine's `abandoned`, design §6.7): the cancelled card, never a result.
  it('an abandoned match is the cancelled card, not a recorded result', () => {
    expect(padOf([...GOAL_AT_41, ABANDON]).card).toEqual({ kind: 'cancelled' });
  });

  it('a match in play has no card, and neither does one not started (the runtime’s card)', () => {
    expect(padOf(GOAL_AT_41).card).toBeNull();
    expect(padOf([]).card).toBeNull();
  });

  it('a queued tap shows as the last tap while it is on its way', () => {
    const pad = footballPad(
      displayOf(KICK_OFF, MATCH, {
        queued: [queuedOf('k1', goal({ by: 'A', at: at('H1', 60) }))],
      }),
    );
    expect(pad.lastTap?.text).toEqual({
      key: 'scoring.football.last.goal',
      vars: { team: 'Away FC', who: '', at: " 2'" },
    });
  });
});

describe('footballResultLine: Home’s Finished card (design §6.7)', () => {
  it('is empty until the match is decided', () => {
    expect(footballResultLine(displayOf(GOAL_AT_41))).toBe('');
    expect(footballResultLine(displayOf(KICKS_4_3))).toBe('');
  });

  it('reads 2–1 at full time, first side first', () => {
    const league = withCfg(MATCH, LEAGUE_11);
    const twoOne = [
      ...KICK_OFF,
      goal({ by: 'A', at: at('H1', 600) }),
      goal({ by: 'H', at: at('H1', 1200) }),
      goal({ by: 'H', at: at('H1', 1800) }),
      period('HT', at('H1', 2700)),
      clock(true, at('H2', 0)),
      period('FT', at('H2', 2700)),
    ];
    expect(footballResultLine(displayOf(twoOne, league))).toBe('2–1');
  });

  it('reads 5–5 (4–1) after a shootout', () => {
    expect(footballResultLine(displayOf(KICKS_4_1))).toBe('5–5 (4–1)');
  });

  it('is empty for an abandoned match, whatever the score stood at', () => {
    const abandoned = displayOf([...GOAL_AT_41, ABANDON]);
    expect(abandoned.phase).toBe('decided');
    expect(abandoned.goals).toEqual({ first: 1, second: 0 });
    expect(footballResultLine(abandoned)).toBe('');
  });
});

/** Every `key` in a value, nested fills included. */
function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([name, one]) =>
    name === 'key' && typeof one === 'string' ? [one] : keysIn(one),
  );
}

// A key the dictionaries lack fails to compile here (`PadView<MessageKey>`), and the sweep proves it at run time too.
describe('footballPad: its words', () => {
  const sweep: readonly PadView<MessageKey>[] = [
    padOf([]),
    padOf(KICK_OFF),
    padOf(GOAL_AT_41, MATCH, { ownEventIds: [eventId(3)] }),
    padOf([...GOAL_AT_41, voiding(eventId(3))]),
    padOf(LEVEL_AFTER_ET.slice(0, -1)),
    padOf(KICKS_4_3),
    padOf(KICKS_4_1),
    padOf(KICK_OFF, withCfg(MATCH, MINI)),
  ];
  const named = new Set(keysIn(sweep));

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s has every key the pad names',
    (_lang, dictionary: Readonly<Record<string, string>>) => {
      // The sweep names 25 keys at engine 2.0.0: a sweep that names few or none proves nothing (the review's M3).
      expect(named.size).toBeGreaterThan(20);
      expect([...named].filter((key) => !(key in dictionary))).toEqual([]);
    },
  );

  it('reads the design’s words from the dictionary', () => {
    expect(en['scoring.football.end.HT']).toBe('Half-time');
    expect(en['scoring.football.end.QT']).toBe('End Q1');
    expect(en['scoring.football.end.ET_FT']).toBe('End of extra time');
    expect(en['scoring.football.last.goal']).toBe('Goal · {team}{who}{at}');
  });
});
