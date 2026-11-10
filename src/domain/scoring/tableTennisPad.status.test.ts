import { describe, expect, it } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import {
  tableTennisExpediteConfirm,
  tableTennisMoreOptions,
  tableTennisPad,
  tableTennisServingTitle,
  withHeldServing,
  type TableTennisDisplay,
  type TableTennisLastTap,
} from '@/domain/scoring/tableTennisPad';
import { pre, live, unanchored, expedited, doubles } from '@/domain/scoring/tableTennisPad.testkit';
import { cardSheet, startCard } from '@/domain/scoring/tableTennisSanction';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { MessageKey } from '@/i18n/messages';

describe('tableTennisPad: the last tap', () => {
  const lastOf = (lastTap: TableTennisLastTap | null, display = live) =>
    tableTennisPad({ ...display, lastTap }).lastTap?.text;

  it('has none before the first tap, and none on the Start screen', () => {
    expect(tableTennisPad({ ...pre, lastTap: null }).lastTap).toBeNull();
    const started = { kind: 'start', server: 'first' } as const;
    expect(tableTennisPad({ ...pre, phase: 'notStarted', lastTap: started }).lastTap).toBeNull();
  });

  it('says a point in the History words: who won it, and the game it won', () => {
    expect(lastOf({ kind: 'rally', side: 'second', won: 'none', game: 1 })).toEqual({
      key: 'scoring.tabletennis.last.rally',
      vars: { side: 'L. Chen' },
    });
    expect(lastOf({ kind: 'rally', side: 'first', won: 'game', game: 2 })).toEqual({
      key: 'scoring.tabletennis.last.game',
      vars: { game: 2, side: 'A. Sharma' },
    });
  });

  it('says a card, a timeout, Expedite and a set score', () => {
    expect(lastOf({ kind: 'timeout', side: 'first' })).toEqual({
      key: 'scoring.tabletennis.last.timeout',
      vars: { side: 'A. Sharma' },
    });
    expect(lastOf({ kind: 'expedite' })).toEqual({ key: 'scoring.tabletennis.last.expedite' });
    expect(lastOf({ kind: 'setScore', first: 5, second: 3 })).toEqual({
      key: 'scoring.tabletennis.last.setScore',
      vars: { score: '5–3' },
    });
    expect(
      lastOf({ kind: 'sanction', side: 'first', level: 'penalty', person: 'A. Sharma' }),
    ).toEqual({
      key: 'scoring.tabletennis.last.sanction',
      vars: { level: { key: 'scoring.tabletennis.card.penalty' }, person: 'A. Sharma' },
    });
  });

  // Ruling 2: each tap Undo can take back has its own words, as badminton's undone.rally and undone.sanction.
  it.each([
    [
      { kind: 'rally', side: 'first', won: 'none', game: 1 },
      { key: 'scoring.tabletennis.undone.rally', vars: { side: 'A. Sharma' } },
    ],
    [
      { kind: 'returns', side: 'second', won: 'none', game: 1, returns: 13 },
      { key: 'scoring.tabletennis.undone.returns', vars: { side: 'L. Chen', returns: 13 } },
    ],
    [
      { kind: 'timeout', side: 'second' },
      { key: 'scoring.tabletennis.undone.timeout', vars: { side: 'L. Chen' } },
    ],
    [{ kind: 'expedite' }, { key: 'scoring.tabletennis.undone.expedite' }],
    [
      { kind: 'sanction', side: 'first', level: 'warning', person: 'A. Sharma' },
      {
        key: 'scoring.tabletennis.undone.sanction',
        vars: { level: { key: 'scoring.tabletennis.card.warning' }, person: 'A. Sharma' },
      },
    ],
    [{ kind: 'setScore', first: 1, second: 2 }, { key: 'scoring.tabletennis.undone.setScore' }],
  ] as const)('says what Undo took back: %j', (tap, text) => {
    expect(lastOf({ kind: 'undone', tap })).toEqual(text);
  });

  it('says a 13 returns point with its returns, and a start with its server or without', () => {
    expect(lastOf({ kind: 'returns', side: 'first', won: 'none', game: 1, returns: 13 })).toEqual({
      key: 'scoring.tabletennis.last.returns',
      vars: {
        point: { key: 'scoring.tabletennis.last.rally', vars: { side: 'A. Sharma' } },
        returns: 13,
      },
    });
    expect(lastOf({ kind: 'start', server: null })).toEqual({
      key: 'scoring.tabletennis.last.startUnknownServer',
    });
    expect(lastOf({ kind: 'start', server: 'second' })).toEqual({
      key: 'scoring.tabletennis.last.start',
      vars: { side: 'L. Chen' },
    });
  });

  it('offers Undo only when this phone has a tap of its own to take back', () => {
    expect(tableTennisPad(live).lastTap?.undo).toBe(true);
    expect(tableTennisPad({ ...live, undoable: false }).lastTap?.undo).toBe(false);
  });
});

describe('tableTennisPad: sync, the tally, the match details and the Start screen', () => {
  it('is synced unless told otherwise, and passes the transport’s word through', () => {
    expect(tableTennisPad(live).sync).toEqual({ kind: 'synced' });
    expect(tableTennisPad(live, { kind: 'offline', count: 3 }).sync).toEqual({
      kind: 'offline',
      count: 3,
    });
  });

  describe('the games tally', () => {
    const said = (firstGames: number, secondGames: number) => ({
      key: 'scoring.tabletennis.gamesTally',
      vars: { first: 'A. Sharma', firstGames, second: 'L. Chen', secondGames },
    });

    it('starts at 0:0, said with both sides’ names', () => {
      expect(tableTennisPad(pre).tally).toEqual({ shown: '0:0', said: said(0, 0) });
    });

    it('counts the games each side won, the top side first', () => {
      const finished = [
        { points: { first: 7, second: 11 }, winner: 'second' },
        { points: { first: 11, second: 9 }, winner: 'first' },
        { points: { first: 8, second: 11 }, winner: 'second' },
      ] as const;
      expect(tableTennisPad({ ...live, finished }).tally).toEqual({
        shown: '1:2',
        said: said(1, 2),
      });
    });
  });

  it('carries the match’s context as kept, and the rule rows of its config', () => {
    const view = tableTennisPad(pre);
    expect(view.details.context.competition).toBe('Spring Open 2026');
    expect(view.details.rules.map((row) => row.label.key)).toEqual([
      'scoring.tabletennis.rules.format.label',
      'scoring.tabletennis.rules.points.label',
      'scoring.tabletennis.rules.expedite.label',
      'scoring.tabletennis.rules.timeouts.label',
    ]);
  });

  it('keeps the details under a card', () => {
    const view = tableTennisPad({ ...live, phase: 'decided' });
    expect(view.card).not.toBeNull();
    expect(view.details.rules).toHaveLength(4);
  });

  // Plan Review Focus 5: a hardbat match (games to 21) reads 21 in every place the pad names a target.
  it('hardbat cfg reads 21 everywhere', () => {
    const hardbat: TableTennisDisplay = {
      ...pre,
      rules: { bestOf: 5, setTo: 21, finalSetTo: 21, winBy: 2, scoreBound: 41 },
      points: { first: 20, second: 20 },
      phase: 'live',
      deuce: true,
    };
    const view = tableTennisPad(hardbat);
    expect(view.details.rules[1]?.value).toEqual({
      key: 'scoring.tabletennis.rules.points.value',
      vars: { points: 21, winBy: 2 },
    });
    expect(view.strip[1]?.text).toEqual({ key: 'scoring.tabletennis.note.deuce' });
    expect(JSON.stringify(view.details.rules)).not.toContain('11');
  });

  describe('before the match starts (the Start screen)', () => {
    const notStarted: TableTennisDisplay = { ...pre, phase: 'notStarted' };

    it('asks who serves first, offering the two sides as typed, top first', () => {
      expect(tableTennisPad(notStarted).start).toEqual({
        ask: { key: 'scoring.tabletennis.start.ask' },
        needsToss: true,
        sides: [
          { side: 'first', label: 'A. Sharma' },
          { side: 'second', label: 'L. Chen' },
        ],
      });
      expect(en['scoring.tabletennis.start.ask']).toBe('Who serves first?');
    });

    it('joins doubles partners as typed', () => {
      const view = tableTennisPad({ ...doubles, phase: 'notStarted' });
      expect(view.start?.sides.map((side) => side.label)).toEqual([
        'A. Sharma / R. Iyer',
        'L. Chen / M. Wong',
      ]);
    });

    it('offers no tool, no tap and no plate; once started there is no question', () => {
      const view = tableTennisPad(notStarted);
      expect(view.tools).toEqual([]);
      expect(view.halves.map((half) => [half.tappable, half.serving])).toEqual([
        [false, null],
        [false, null],
      ]);
      expect(tableTennisPad(pre).start).toBeNull();
      expect(tableTennisPad(live).start).toBeNull();
    });
  });
});

// Design §4.2: the Who is serving? answer is held in memory, and the pad says so on the last-tap line until it is used.
describe('withHeldServing: “Next point: {side} serving”', () => {
  const view = tableTennisPad(unanchored);

  it('says the held side on the last-tap line, and leaves the rest of the view as it was', () => {
    const held = withHeldServing(view, 'second', unanchored);
    expect(held.lastTap?.text).toEqual({
      key: 'scoring.tabletennis.held',
      vars: { side: 'L. Chen' },
    });
    expect({ ...held, lastTap: null }).toEqual({ ...view, lastTap: null });
    expect(en['scoring.tabletennis.held']).toBe('Next point: {side} serving');
  });

  it('keeps the Undo of this phone’s last real tap beside it, on or off', () => {
    expect(withHeldServing(view, 'first', unanchored).lastTap?.undo).toBe(true);
    const off = { ...unanchored, undoable: false };
    expect(withHeldServing(tableTennisPad(off), 'first', off).lastTap?.undo).toBe(false);
  });

  it('draws the line when there is no last tap yet, with no Undo (a match started elsewhere)', () => {
    const fresh = { ...unanchored, lastTap: null, undoable: false };
    expect(withHeldServing(tableTennisPad(fresh), 'first', fresh).lastTap).toEqual({
      text: { key: 'scoring.tabletennis.held', vars: { side: 'A. Sharma' } },
      undo: false,
    });
  });

  it('names a doubles side as its partners joined', () => {
    const pair = { ...unanchored, sides: doubles.sides };
    const text = withHeldServing(tableTennisPad(pair), 'second', pair).lastTap?.text;
    expect(text).toEqual({
      key: 'scoring.tabletennis.held',
      vars: { side: 'L. Chen / M. Wong' },
    });
  });

  it('follows a second answer: the other side held, the line changes', () => {
    const first = withHeldServing(view, 'first', unanchored);
    const second = withHeldServing(first, 'second', unanchored);
    expect(second.lastTap?.text).toEqual({
      key: 'scoring.tabletennis.held',
      vars: { side: 'L. Chen' },
    });
  });

  it('is the view itself with nothing held', () => {
    expect(withHeldServing(view, null, unanchored)).toBe(view);
  });

  // The hook clears the answer when the engine names a server; until it does, a stale one is not shown as true.
  it('says nothing once the pad no longer needs the answer', () => {
    const named = tableTennisPad(live);
    expect(withHeldServing(named, 'first', live)).toBe(named);
  });

  it('says nothing under a card: nothing takes a point there', () => {
    const decided = { ...unanchored, phase: 'decided' } as const;
    const carded = tableTennisPad(decided);
    const stillNeeded = { ...decided, anchorNeeded: true };
    expect(withHeldServing(carded, 'first', stillNeeded)).toBe(carded);
  });
});

// The words the pad names are dictionary keys: a key the dictionaries lack fails to compile where the kit takes it, and
// this proves it at run time too, in all four languages, with no dead key left behind.
describe('tableTennisPad: its words', () => {
  const sweep: readonly PadView<MessageKey>[] = [
    tableTennisPad({ ...pre, phase: 'notStarted' }),
    tableTennisPad(pre),
    tableTennisPad(live),
    tableTennisPad({ ...live, serveNumber: null, deuce: true }),
    tableTennisPad(expedited),
    tableTennisPad(unanchored),
    // The one row of four: Set score, Expedite and Who is serving? are drawn in their short words.
    tableTennisPad({
      ...pre,
      server: null,
      serveNumber: null,
      serverPicked: false,
      anchorNeeded: true,
    }),
    withHeldServing(tableTennisPad(unanchored), 'first', unanchored),
    tableTennisPad({
      ...doubles,
      serverPerson: 'M. Wong',
      serverPersonId: 'p-wong',
      finished: [{ points: { first: 11, second: 7 }, winner: 'first' }],
    }),
    tableTennisPad({ ...live, phase: 'decided' }),
  ];
  const lastTaps: readonly TableTennisLastTap[] = [
    { kind: 'start', server: 'first' },
    { kind: 'start', server: null },
    { kind: 'rally', side: 'first', won: 'none', game: 1 },
    { kind: 'rally', side: 'first', won: 'game', game: 1 },
    { kind: 'rally', side: 'first', won: 'match', game: 1 },
    { kind: 'returns', side: 'first', won: 'none', game: 1, returns: 13 },
    { kind: 'timeout', side: 'first' },
    { kind: 'expedite' },
    { kind: 'sanction', side: 'first', level: 'warning', person: 'A. Sharma' },
    { kind: 'setScore', first: 1, second: 2 },
    { kind: 'undone', tap: { kind: 'rally', side: 'first', won: 'none', game: 1 } },
    { kind: 'undone', tap: { kind: 'returns', side: 'first', won: 'none', game: 1, returns: 13 } },
    { kind: 'undone', tap: { kind: 'timeout', side: 'first' } },
    { kind: 'undone', tap: { kind: 'expedite' } },
    { kind: 'undone', tap: { kind: 'sanction', side: 'first', level: 'penalty', person: 'x' } },
    { kind: 'undone', tap: { kind: 'setScore', first: 1, second: 2 } },
  ];

  /** Every `key` in a value, nested fills included. */
  function keysIn(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(keysIn);
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([name, one]) =>
      name === 'key' && typeof one === 'string' ? [one] : keysIn(one),
    );
  }

  const named = new Set([
    ...keysIn(sweep),
    ...lastTaps.flatMap((lastTap) => keysIn(tableTennisPad({ ...live, lastTap }).lastTap)),
    ...keysIn(tableTennisMoreOptions(pre)),
    ...keysIn(tableTennisServingTitle),
    ...keysIn(tableTennisExpediteConfirm),
    // The Card sheet's title is the sanction module's, since the Card cells became More items (ruling 54).
    ...keysIn(cardSheet(startCard('first'), live.sides)),
    ...keysIn(tableTennisPad({ ...pre, rules: { ...pre.rules, finalSetTo: 7 } }).details),
    ...keysIn(
      tableTennisPad({ ...pre, records: { timeouts: true, sanctions: true, expedite: true } })
        .details,
    ),
  ]);

  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)(
    '%s has every key the pad names',
    (_lang, dictionary: Readonly<Record<string, string>>) => {
      const missing = [...named].filter((key) => !(key in dictionary));
      expect(missing).toEqual([]);
    },
  );

  it('names every table tennis key in the dictionary but the History heading and the plural’s one form', () => {
    const unnamed = Object.keys(en).filter(
      (key) =>
        key.startsWith('scoring.tabletennis.') &&
        !named.has(key) &&
        key !== 'scoring.tabletennis.gameHeading' &&
        !key.endsWith('.one'),
    );
    expect(unnamed).toEqual([]);
  });
});
