import { describe, expect, it } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import {
  parseTableTennisTool,
  tableTennisMoreItems,
  tableTennisMoreOptions,
  tableTennisPad,
  withHeldServing,
  type TableTennisDisplay,
  type TableTennisLastTap,
} from '@/domain/scoring/tableTennisPad';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { MessageKey } from '@/i18n/messages';

// The table tennis pad (design §5, ruling 52's tools table is the acceptance table for §5.3). Displays are written out
// by hand: the fold (tableTennisFold.test.ts) decides every fact, and this only draws them.

/** Game 1 of a best of 5, singles, before the first point, the Start pick standing in as the server. */
const pre: TableTennisDisplay = {
  sides: { first: { players: ['A. Sharma'] }, second: { players: ['L. Chen'] } },
  context: {
    competition: 'Spring Open 2026',
    division: 'U15 Boys Singles',
    round: 'Round 1',
    match: 'Match 4',
    sides: ['A. Sharma', 'L. Chen'],
  },
  points: { first: 0, second: 0 },
  finished: [],
  game: 1,
  rules: { bestOf: 5, setTo: 11, finalSetTo: 11, winBy: 2, scoreBound: 31 },
  phase: 'pre',
  server: 'first',
  serverPerson: null,
  serverPersonId: null,
  serveNumber: 1,
  serverPicked: true,
  anchorNeeded: false,
  expedite: 'offered',
  deuce: false,
  records: { timeouts: true, sanctions: true, expedite: true },
  scoreEvents: 0,
  lastTap: null,
  undoable: false,
};

/** 6–9 in game 1, the second side serving its second serve of the pair. */
const live: TableTennisDisplay = {
  ...pre,
  points: { first: 6, second: 9 },
  scoreEvents: 15,
  phase: 'live',
  server: 'second',
  serveNumber: 2,
  serverPicked: false,
  lastTap: { kind: 'rally', side: 'second', won: 'none', game: 1 },
  undoable: true,
};

/** Live, but the engine names no server and this phone's pick is not standing in: the pad asks (ruling 51). */
const unanchored: TableTennisDisplay = {
  ...live,
  server: null,
  serveNumber: null,
  anchorNeeded: true,
};

const expedited: TableTennisDisplay = { ...live, expedite: 'inForce' };

const doubles: TableTennisDisplay = {
  ...live,
  sides: {
    first: { players: ['A. Sharma', 'R. Iyer'] },
    second: { players: ['L. Chen', 'M. Wong'] },
  },
};

const ids = (view: PadView<string>) => view.tools.map((tool) => tool.id);
/** The 13 returns cell, if any: its id names the receiver it was drawn for (`returns.first`, `returns.second`). */
const returnsCell = (view: PadView<string>) =>
  view.tools.find((tool) => tool.id.startsWith('returns.'));

describe('tableTennisPad: the halves', () => {
  it('puts the first side on top and the second below, with the points as the big value', () => {
    expect(tableTennisPad(live).halves.map((half) => [half.side, half.label, half.value])).toEqual([
      ['first', 'A. Sharma', '6'],
      ['second', 'L. Chen', '9'],
    ]);
  });

  it('joins doubles partners as typed', () => {
    expect(tableTennisPad(doubles).halves.map((half) => half.label)).toEqual([
      'A. Sharma / R. Iyer',
      'L. Chen / M. Wong',
    ]);
  });

  describe('the serving plate (design §5.1: the engine’s serve number, never ours)', () => {
    const plates = (display: TableTennisDisplay) =>
      tableTennisPad(display).halves.map((half) => half.serving);

    it('says the second serve of the pair on the serving side’s half only', () => {
      expect(plates(live)).toEqual([
        null,
        {
          shown: { key: 'scoring.tabletennis.serving.second' },
          said: { key: 'scoring.tabletennis.servingSaid.second' },
        },
      ]);
    });

    it('says the first serve of the pair, on whichever side serves', () => {
      expect(plates({ ...live, server: 'first', serveNumber: 1 })).toEqual([
        {
          shown: { key: 'scoring.tabletennis.serving.first' },
          said: { key: 'scoring.tabletennis.servingSaid.first' },
        },
        null,
      ]);
    });

    it('says Serving alone when the engine names no number', () => {
      expect(plates({ ...live, serveNumber: null })).toEqual([
        null,
        {
          shown: { key: 'scoring.tabletennis.serving.plain' },
          said: { key: 'scoring.tabletennis.servingSaid.plain' },
        },
      ]);
    });

    // The brief’s three wordings: “Serving · 1st”, “Serving · 2nd”, “Serving”.
    it('reads, in English: Serving · 1st, Serving · 2nd, Serving', () => {
      expect(en['scoring.tabletennis.serving.first']).toBe('Serving · 1st');
      expect(en['scoring.tabletennis.serving.second']).toBe('Serving · 2nd');
      expect(en['scoring.tabletennis.serving.plain']).toBe('Serving');
      expect(en['scoring.tabletennis.servingSaid.first']).toBe('Serving, first serve');
      expect(en['scoring.tabletennis.servingSaid.second']).toBe('Serving, second serve');
      expect(en['scoring.tabletennis.servingSaid.plain']).toBe('Serving');
    });

    it('shows the Start pick on the plate as the first serve, before the match’s first point', () => {
      expect(plates(pre)).toEqual([
        {
          shown: { key: 'scoring.tabletennis.serving.first' },
          said: { key: 'scoring.tabletennis.servingSaid.first' },
        },
        null,
      ]);
    });

    it('draws no plate while the engine names no server (a lost pick): neither half', () => {
      expect(plates(unanchored)).toEqual([null, null]);
    });

    it('draws no plate before the match starts or once it is decided', () => {
      expect(plates({ ...pre, phase: 'notStarted' })).toEqual([null, null]);
      expect(plates({ ...live, phase: 'decided' })).toEqual([null, null]);
    });

    it('keeps the plate between games, when the engine has the next game’s server', () => {
      expect(plates({ ...live, phase: 'betweenGames' })[1]).not.toBeNull();
    });
  });

  // The lime bar follows the plate (owner, 2026-11-02, as badminton's): lit on the serving side, dim on the other.
  describe('the side bar follows the server', () => {
    const bars = (display: TableTennisDisplay) =>
      tableTennisPad(display).halves.map((half) => half.bar);

    it('lights the serving side’s bar, whichever side that is', () => {
      expect(bars({ ...live, server: 'second' })).toEqual(['dim', 'lit']);
      expect(bars({ ...live, server: 'first' })).toEqual(['lit', 'dim']);
    });

    it('lights the pick on the Start screen’s first point, as the plate shows it', () => {
      expect(bars({ ...pre, server: 'second' })).toEqual(['dim', 'lit']);
    });

    it('dims both while no server is known', () => {
      expect(bars(unanchored)).toEqual(['dim', 'dim']);
    });

    it('lights exactly the half that has the plate, in every phase', () => {
      const phases = ['notStarted', 'pre', 'live', 'betweenGames', 'decided'] as const;
      const servers = ['first', 'second', null] as const;
      for (const phase of phases) {
        for (const server of servers) {
          const halves = tableTennisPad({ ...live, phase, server }).halves;
          expect(
            halves.map((half) => half.bar === 'lit'),
            `${phase}/${String(server)}`,
          ).toEqual(halves.map((half) => half.serving !== null));
        }
      }
    });
  });

  // Ruling 5 of the brief: the named doubles player goes in the half's `sub`, only when `serverPersonId` is set.
  describe('the doubles server, in the half’s own line', () => {
    const named: TableTennisDisplay = {
      ...doubles,
      server: 'second',
      serverPerson: 'M. Wong',
      serverPersonId: 'p-wong',
    };

    it('names the serving player on the serving side’s half, and nothing on the other', () => {
      expect(tableTennisPad(named).halves.map((half) => half.sub)).toEqual([
        null,
        { key: 'scoring.tabletennis.serverPerson', vars: { person: 'M. Wong' } },
      ]);
      expect(en['scoring.tabletennis.serverPerson']).toBe('{person} serves');
    });

    it('names nobody without an id: the plate names the side only', () => {
      const unnamed = { ...named, serverPersonId: null };
      expect(tableTennisPad(unnamed).halves.map((half) => half.sub)).toEqual([null, null]);
      expect(tableTennisPad(doubles).halves.map((half) => half.sub)).toEqual([null, null]);
    });

    it('names nobody without a name, even with an id', () => {
      const idOnly = { ...named, serverPerson: null };
      expect(tableTennisPad(idOnly).halves.map((half) => half.sub)).toEqual([null, null]);
    });

    it('names nobody while no plate is drawn (no server, or the match is over)', () => {
      const none = tableTennisPad({ ...named, server: null }).halves;
      expect(none.map((half) => half.sub)).toEqual([null, null]);
      const over = tableTennisPad({ ...named, phase: 'decided' }).halves;
      expect(over.map((half) => half.sub)).toEqual([null, null]);
    });

    it('follows the serve to the other side, with its own player', () => {
      const other = {
        ...named,
        server: 'first',
        serverPerson: 'R. Iyer',
        serverPersonId: 'p-iyer',
      } as const;
      expect(tableTennisPad(other).halves.map((half) => half.sub)).toEqual([
        { key: 'scoring.tabletennis.serverPerson', vars: { person: 'R. Iyer' } },
        null,
      ]);
    });
  });

  it('has no finished game’s score in game 1', () => {
    expect(tableTennisPad(live).halves.map((half) => half.periods)).toEqual([null, null]);
  });

  // Game 1 11–7 to the first side, game 2 9–11 to the second, game 3 under way: each half reads its own scores.
  const twoGames: TableTennisDisplay = {
    ...live,
    finished: [
      { points: { first: 11, second: 7 }, winner: 'first' },
      { points: { first: 9, second: 11 }, winner: 'second' },
    ],
    game: 3,
  };

  it('shows each side’s score in every finished game, in game order, the games it won marked', () => {
    expect(tableTennisPad(twoGames).halves.map((half) => half.periods?.scores)).toEqual([
      [
        { value: '11', won: true },
        { value: '9', won: false },
      ],
      [
        { value: '7', won: false },
        { value: '11', won: true },
      ],
    ]);
  });

  it('says a side’s finished games to a screen reader, in game order, counted for the plural', () => {
    expect(tableTennisPad(twoGames).halves.map((half) => half.periods?.said)).toEqual([
      [{ key: 'scoring.tabletennis.gamesSaid.other', count: 2, vars: { scores: '11, 9' } }],
      [{ key: 'scoring.tabletennis.gamesSaid.other', count: 2, vars: { scores: '7, 11' } }],
    ]);
    const one = tableTennisPad({ ...twoGames, finished: twoGames.finished.slice(0, 1) });
    expect(one.halves[1].periods).toEqual({
      scores: [{ value: '7', won: false }],
      said: [{ key: 'scoring.tabletennis.gamesSaid.other', count: 1, vars: { scores: '7' } }],
    });
    expect(en['scoring.tabletennis.gamesSaid.one']).toBe('Game: {scores}');
    expect(en['scoring.tabletennis.gamesSaid.other']).toBe('Games: {scores}');
  });

  it('tells a screen reader that a tap awards the point, and shows each half’s hint with its names', () => {
    expect(tableTennisPad(live).halves.map((half) => half.hint)).toEqual([
      { key: 'scoring.tabletennis.hint' },
      { key: 'scoring.tabletennis.hint' },
    ]);
    expect(tableTennisPad(doubles).halves.map((half) => half.hintLine)).toEqual([
      { key: 'scoring.tabletennis.hintLine', vars: { side: 'A. Sharma / R. Iyer' } },
      { key: 'scoring.tabletennis.hintLine', vars: { side: 'L. Chen / M. Wong' } },
    ]);
    expect(en['scoring.tabletennis.hint']).toBe('Tap to award the point');
    expect(en['scoring.tabletennis.hintLine']).toBe('Tap: point to {side}');
  });

  it.each(['pre', 'live', 'betweenGames'] as const)('takes taps %s', (phase) => {
    expect(tableTennisPad({ ...live, phase }).halves.map((half) => half.tappable)).toEqual([
      true,
      true,
    ]);
  });

  it.each(['notStarted', 'decided'] as const)('takes no tap %s', (phase) => {
    expect(tableTennisPad({ ...live, phase }).halves.map((half) => half.tappable)).toEqual([
      false,
      false,
    ]);
  });
});

describe('tableTennisPad: the strip', () => {
  const slots = (display: TableTennisDisplay) =>
    tableTennisPad(display).strip.map((item) => [item.slot, item.text]);

  it('names the game of how many, in the first slot, and keeps the note’s slot', () => {
    expect(slots(live)).toEqual([
      ['game', { key: 'scoring.tabletennis.gameOf', vars: { game: 1, bestOf: 5 } }],
      ['note', null],
    ]);
    expect(en['scoring.tabletennis.gameOf']).toBe('Game {game} of {bestOf}');
  });

  it('reads the game and the format from the match: game 4 of a best of 7', () => {
    const view = tableTennisPad({ ...live, game: 4, rules: { ...live.rules, bestOf: 7 } });
    expect(view.strip[0]?.text).toEqual({
      key: 'scoring.tabletennis.gameOf',
      vars: { game: 4, bestOf: 7 },
    });
  });

  // Design §5.2: one note at the right, “Expedite” (in force, match-wide) before “Deuce”, else nothing.
  describe('the note: Expedite, then Deuce, then nothing', () => {
    const note = (display: TableTennisDisplay) => tableTennisPad(display).strip[1]?.text;

    it('says Deuce at a level endgame score', () => {
      expect(note({ ...live, deuce: true })).toEqual({ key: 'scoring.tabletennis.note.deuce' });
      expect(en['scoring.tabletennis.note.deuce']).toBe('Deuce');
    });

    it('says Expedite once it is in force, for the rest of the match', () => {
      expect(note(expedited)).toEqual({ key: 'scoring.tabletennis.note.expedite' });
      expect(note({ ...expedited, phase: 'betweenGames' })).toEqual({
        key: 'scoring.tabletennis.note.expedite',
      });
      expect(en['scoring.tabletennis.note.expedite']).toBe('Expedite');
    });

    it('says Expedite, not Deuce, when both hold', () => {
      expect(note({ ...expedited, deuce: true })).toEqual({
        key: 'scoring.tabletennis.note.expedite',
      });
    });

    it('says nothing when Expedite is only offered or off, and no deuce', () => {
      expect(note({ ...live, expedite: 'offered' })).toBeNull();
      expect(note({ ...live, expedite: 'off' })).toBeNull();
    });

    it('says nothing once the match is decided, whatever the engine still holds', () => {
      expect(note({ ...expedited, deuce: true, phase: 'decided' })).toBeNull();
    });
  });

  it('keeps both slots once the match is decided, naming the last game', () => {
    const decided = tableTennisPad({ ...live, phase: 'decided', game: 3 });
    expect(decided.strip.map((item) => [item.slot, item.text])).toEqual([
      ['game', { key: 'scoring.tabletennis.gameOf', vars: { game: 3, bestOf: 5 } }],
      ['note', null],
    ]);
  });
});

// Ruling 52 and design §5.3: one row, at most four cells. This is the acceptance table, a row at a time.
describe('tableTennisPad: the tools', () => {
  describe('Card · {top}, Card · {bottom}: live, and the match records cards', () => {
    it('offers a Card for each side, the side’s names beneath, in the caution outline', () => {
      expect(tableTennisPad(live).tools.slice(0, 2)).toEqual([
        {
          id: 'card.first',
          label: { key: 'scoring.tabletennis.tool.card' },
          detail: 'A. Sharma',
          kind: 'destructive',
          enabled: true,
        },
        {
          id: 'card.second',
          label: { key: 'scoring.tabletennis.tool.card' },
          detail: 'L. Chen',
          kind: 'destructive',
          enabled: true,
        },
      ]);
      expect(en['scoring.tabletennis.tool.card']).toBe('Card');
    });

    it('names a doubles side as its partners joined', () => {
      expect(
        tableTennisPad(doubles)
          .tools.slice(0, 2)
          .map((tool) => tool.detail),
      ).toEqual(['A. Sharma / R. Iyer', 'L. Chen / M. Wong']);
    });

    it('offers them before the first point and between games, as badminton’s Sanction is', () => {
      expect(ids(tableTennisPad(pre))).toContain('card.first');
      expect(ids(tableTennisPad({ ...live, phase: 'betweenGames' }))).toContain('card.second');
    });

    it('hides them when the match does not record cards', () => {
      const records = { ...live.records, sanctions: false };
      expect(ids(tableTennisPad({ ...live, records }))).toEqual(['more']);
    });

    it('hides them on the Start screen and once the match is decided', () => {
      expect(tableTennisPad({ ...pre, phase: 'notStarted' }).tools).toEqual([]);
      expect(tableTennisPad({ ...live, phase: 'decided' }).tools).toEqual([]);
    });
  });

  describe('13 returns · {receiver}: Expedite in force, the server known (ruling 50)', () => {
    it('gives the receiving side the point, and says the receiver beneath: the server’s opponent', () => {
      const [, , returns] = tableTennisPad(expedited).tools;
      expect(returns).toEqual({
        id: 'returns.first',
        label: { key: 'scoring.tabletennis.tool.returns', vars: { returns: 13 } },
        detail: 'A. Sharma',
        kind: 'standard',
        enabled: true,
      });
      expect(en['scoring.tabletennis.tool.returns']).toBe('{returns} returns');
    });

    it('follows the serve: the other side serving, the other side receiving', () => {
      const view = tableTennisPad({ ...expedited, server: 'first', serveNumber: 1 });
      expect(returnsCell(view)).toMatchObject({ id: 'returns.second', detail: 'L. Chen' });
    });

    it('names a doubles receiver as its partners joined', () => {
      const view = tableTennisPad({ ...doubles, expedite: 'inForce' });
      expect(returnsCell(view)?.detail).toBe('A. Sharma / R. Iyer');
    });

    it('is hidden while Expedite is only offered, or off', () => {
      expect(returnsCell(tableTennisPad({ ...live, expedite: 'offered' }))).toBeUndefined();
      expect(returnsCell(tableTennisPad({ ...live, expedite: 'off' }))).toBeUndefined();
    });

    it('is hidden while the engine names no server', () => {
      const noServer = { ...expedited, server: null, serveNumber: null };
      expect(returnsCell(tableTennisPad(noServer))).toBeUndefined();
    });

    // The Start pick is not the engine's belief (the fold's mayCreditReceiver reads the engine): a point at once under
    // Expedite, started at 0–0, cannot be judged a receiver's yet.
    it('is hidden while the server shown is only this phone’s Start pick', () => {
      const picked = { ...expedited, phase: 'pre', serverPicked: true } as const;
      expect(returnsCell(tableTennisPad(picked))).toBeUndefined();
    });
  });

  describe('Who is serving?: the server unknown for want of an anchor (ruling 51)', () => {
    it('is offered when the pad needs the answer', () => {
      const [, , serving] = tableTennisPad(unanchored).tools;
      expect(serving).toEqual({
        id: 'serving',
        label: { key: 'scoring.tabletennis.tool.serving' },
        detail: null,
        kind: 'standard',
        enabled: true,
      });
      expect(en['scoring.tabletennis.tool.serving']).toBe('Who is serving?');
    });

    it('is hidden once the engine names a server', () => {
      expect(ids(tableTennisPad(live))).not.toContain('serving');
    });

    it('is hidden when no answer would be read: the pad does not need one', () => {
      expect(ids(tableTennisPad({ ...unanchored, anchorNeeded: false }))).not.toContain('serving');
    });
  });

  it('never offers 13 returns and Who is serving? together, whichever the display says', () => {
    const both = tableTennisPad({ ...expedited, anchorNeeded: true });
    expect(ids(both).filter((id) => id.startsWith('returns.') || id === 'serving')).toHaveLength(1);
    expect(ids(both)).toContain('serving');
  });

  describe('More: live, and the sheet has at least one item', () => {
    it('is the last cell, a plain outline with no second line', () => {
      expect(tableTennisPad(live).tools.at(-1)).toEqual({
        id: 'more',
        label: { key: 'scoring.tabletennis.tool.more' },
        detail: null,
        kind: 'standard',
        enabled: true,
      });
      expect(en['scoring.tabletennis.tool.more']).toBe('More');
    });

    it('is not drawn when nothing is in it: no timeouts, Expedite not offered, a game under way', () => {
      const bare: TableTennisDisplay = {
        ...live,
        expedite: 'off',
        records: { timeouts: false, sanctions: true, expedite: false },
      };
      expect(tableTennisMoreItems(bare)).toEqual([]);
      expect(ids(tableTennisPad(bare))).toEqual(['card.first', 'card.second']);
    });

    it('is drawn for Set score alone, between games', () => {
      const setScoreOnly: TableTennisDisplay = {
        ...live,
        phase: 'betweenGames',
        expedite: 'off',
        records: { timeouts: false, sanctions: false, expedite: false },
      };
      expect(ids(tableTennisPad(setScoreOnly))).toEqual(['more']);
    });
  });

  it('puts the cells in order: the cards, 13 returns or Who is serving?, then More: four at most', () => {
    expect(ids(tableTennisPad(expedited))).toEqual([
      'card.first',
      'card.second',
      'returns.first',
      'more',
    ]);
    expect(ids(tableTennisPad(unanchored))).toEqual([
      'card.first',
      'card.second',
      'serving',
      'more',
    ]);
    expect(ids(tableTennisPad(live))).toEqual(['card.first', 'card.second', 'more']);
    for (const display of [live, expedited, unanchored, doubles, pre]) {
      expect(tableTennisPad(display).tools.length).toBeLessThanOrEqual(4);
    }
  });

  it('reads its own tool ids back, and nothing else', () => {
    expect(parseTableTennisTool('card.first')).toEqual({ card: 'first' });
    expect(parseTableTennisTool('card.second')).toEqual({ card: 'second' });
    expect(parseTableTennisTool('returns.first')).toEqual({ returns: 'first' });
    expect(parseTableTennisTool('returns.second')).toEqual({ returns: 'second' });
    expect(parseTableTennisTool('serving')).toEqual({ serving: true });
    expect(parseTableTennisTool('more')).toEqual({ more: true });
    for (const id of [
      '',
      'card',
      'card.third',
      'undo',
      'MORE',
      'sanction.first',
      'setScore',
      'returns',
      'returns.third',
      'returns.',
    ]) {
      expect(parseTableTennisTool(id), id).toBeNull();
    }
  });

  it('reads back every id the pad gives', () => {
    for (const display of [live, expedited, unanchored]) {
      for (const id of ids(tableTennisPad(display))) {
        expect(parseTableTennisTool(id), id).not.toBeNull();
      }
    }
  });
});

describe('tableTennisMoreItems: what the More sheet lists (design §4, §5.3)', () => {
  it('lists a timeout for each side, then Expedite when it is offered, in a game under way', () => {
    expect(tableTennisMoreItems(live)).toEqual(['timeout.first', 'timeout.second', 'expedite']);
  });

  it('adds Set score before a game’s first point: before the match’s, and between games', () => {
    expect(tableTennisMoreItems(pre)).toEqual([
      'timeout.first',
      'timeout.second',
      'expedite',
      'setScore',
    ]);
    expect(tableTennisMoreItems({ ...live, phase: 'betweenGames' })).toContain('setScore');
  });

  it('offers no Set score once a game is under way', () => {
    expect(tableTennisMoreItems(live)).not.toContain('setScore');
  });

  it('drops Expedite once it is in force, or when it cannot be started', () => {
    expect(tableTennisMoreItems(expedited)).toEqual(['timeout.first', 'timeout.second']);
    expect(tableTennisMoreItems({ ...live, expedite: 'off' })).toEqual([
      'timeout.first',
      'timeout.second',
    ]);
  });

  it('drops the timeouts when the match does not record them', () => {
    const records = { ...live.records, timeouts: false };
    expect(tableTennisMoreItems({ ...live, records })).toEqual(['expedite']);
  });

  it('lists nothing on the Start screen or once the match is decided', () => {
    expect(tableTennisMoreItems({ ...pre, phase: 'notStarted' })).toEqual([]);
    expect(tableTennisMoreItems({ ...live, phase: 'decided' })).toEqual([]);
  });
});

describe('tableTennisMoreOptions: the sheet’s choices, in words', () => {
  it('says a timeout with its side, and Expedite and Set score alone, in the list’s order', () => {
    expect(tableTennisMoreOptions(pre)).toEqual([
      {
        id: 'timeout.first',
        label: { key: 'scoring.tabletennis.more.timeout', vars: { side: 'A. Sharma' } },
      },
      {
        id: 'timeout.second',
        label: { key: 'scoring.tabletennis.more.timeout', vars: { side: 'L. Chen' } },
      },
      { id: 'expedite', label: { key: 'scoring.tabletennis.more.expedite' } },
      { id: 'setScore', label: { key: 'scoring.tabletennis.more.setScore' } },
    ]);
    expect(en['scoring.tabletennis.more.timeout']).toBe('Timeout · {side}');
    expect(en['scoring.tabletennis.more.expedite']).toBe('Expedite');
    expect(en['scoring.tabletennis.more.setScore']).toBe('Set score');
  });

  it('lists exactly what tableTennisMoreItems lists', () => {
    for (const display of [pre, live, expedited, { ...live, phase: 'decided' } as const]) {
      expect(tableTennisMoreOptions(display).map((option) => option.id)).toEqual(
        tableTennisMoreItems(display),
      );
    }
  });
});

describe('tableTennisPad: the decided match', () => {
  const decided: TableTennisDisplay = {
    ...live,
    points: { first: 11, second: 8 },
    finished: [
      { points: { first: 11, second: 7 }, winner: 'first' },
      { points: { first: 9, second: 11 }, winner: 'second' },
      { points: { first: 11, second: 5 }, winner: 'first' },
      { points: { first: 11, second: 9 }, winner: 'first' },
    ],
    game: 4,
    phase: 'decided',
    lastTap: { kind: 'rally', side: 'first', won: 'match', game: 4 },
  };

  it('shows the result card over the final score, with no tool and no tap', () => {
    const view = tableTennisPad(decided);
    expect(view.card).toEqual({ kind: 'resultRecorded', undoLeft: null });
    expect(view.tools).toEqual([]);
    expect(view.halves.map((half) => [half.value, half.tappable, half.serving])).toEqual([
      ['11', false, null],
      ['8', false, null],
    ]);
  });

  it('shows every game’s score, the last game’s too', () => {
    const view = tableTennisPad(decided);
    expect(view.halves[0].periods?.scores.map((box) => [box.value, box.won])).toEqual([
      ['11', true],
      ['9', false],
      ['11', true],
      ['11', true],
    ]);
  });

  it('still offers Undo on this phone’s own last tap', () => {
    expect(tableTennisPad(decided).lastTap).toEqual({
      text: { key: 'scoring.tabletennis.last.match', vars: { side: 'A. Sharma' } },
      undo: true,
    });
  });

  it('has no card before it is decided', () => {
    expect(tableTennisPad(live).card).toBeNull();
  });
});

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
