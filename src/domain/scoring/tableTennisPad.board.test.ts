import { tabletennisPadRules } from '@seazn/engine/pad';
import { describe, expect, it } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import { tableTennisPad, type TableTennisDisplay } from '@/domain/scoring/tableTennisPad';
import { pre, live, unanchored, expedited, doubles } from '@/domain/scoring/tableTennisPad.testkit';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';

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

  // Batch A review (I3, I4): a sport's own plate word and tap label are chess's; table tennis's halves draw neither,
  // singles or doubles, so the kit says "Tap" and the serving plate is the only plate.
  it.each([
    ['singles', pre],
    ['singles, live', live],
    ['doubles', doubles],
  ] as const)('has no plate word and no tap label of its own: %s', (_name, display) => {
    expect(tableTennisPad(display).halves.map((half) => [half.plate, half.action])).toEqual([
      [null, null],
      [null, null],
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

  // Owner ruling 56 (2026-11-04): a side's card is a small upright card at the half's top-right corner, and while
  // Expedite is in force both halves carry a stopwatch before it. ITTF: yellow is a warning; the yellow and the red
  // together are the penalty (the engine's `penalty`, the card the umpire gives with a point).
  describe('the marks in the corner (owner ruling 56)', () => {
    const NONE = { clock: false, cards: [], said: [] };
    const sanctioned = (display: TableTennisDisplay, ...held: TableTennisDisplay['sanctions']) =>
      tableTennisPad({ ...display, sanctions: held });
    const marks = (view: PadView<string>) => view.halves.map((half) => half.marks);

    const CARDS = [
      ['warning', ['caution']],
      ['penalty', ['caution', 'dismissal']],
    ] as const;

    it('maps every card the pad can record (anti-vacuity: the table names exactly the engine’s two)', () => {
      expect(CARDS.map(([level]) => level)).toEqual([...tabletennisPadRules.sanctionLevels]);
    });

    it.each(CARDS)(
      'draws a %s as %j on the side that holds it only, and says its name',
      (level, cards) => {
        const view = sanctioned(live, { side: 'first', level });
        expect(view.halves[0].marks).toEqual({
          clock: false,
          cards,
          said: [{ key: `scoring.tabletennis.card.${level}` }],
        });
        expect(view.halves[1].marks).toEqual(NONE);
      },
    );

    it('draws the second side’s card on the second half', () => {
      const view = sanctioned(live, { side: 'second', level: 'penalty' });
      expect(marks(view)[0]).toEqual(NONE);
      expect(marks(view)[1]?.cards).toEqual(['caution', 'dismissal']);
    });

    it('draws no card for a match with none, and none either side of a cardless Expedite', () => {
      expect(marks(tableTennisPad(live))).toEqual([NONE, NONE]);
      for (const half of tableTennisPad(expedited).halves) expect(half.marks.cards).toEqual([]);
    });

    it('draws a side’s heaviest card only: a penalty over a warning, in either order', () => {
      const a = sanctioned(
        live,
        { side: 'first', level: 'warning' },
        { side: 'first', level: 'penalty' },
      );
      const b = sanctioned(
        live,
        { side: 'first', level: 'penalty' },
        { side: 'first', level: 'warning' },
      );
      for (const view of [a, b]) {
        expect(view.halves[0].marks.cards).toEqual(['caution', 'dismissal']);
        expect(view.halves[0].marks.said).toEqual([{ key: 'scoring.tabletennis.card.penalty' }]);
      }
      const twice = sanctioned(
        live,
        { side: 'first', level: 'warning' },
        { side: 'first', level: 'warning' },
      );
      expect(twice.halves[0].marks.cards).toEqual(['caution']);
    });

    it('holds each side’s own card', () => {
      const view = sanctioned(
        live,
        { side: 'first', level: 'penalty' },
        { side: 'second', level: 'warning' },
      );
      expect(view.halves.map((half) => half.marks.cards)).toEqual([
        ['caution', 'dismissal'],
        ['caution'],
      ]);
    });

    describe('the clock: Expedite in force, on both halves', () => {
      it('draws a stopwatch on BOTH halves while Expedite is in force, and says Expedite on each', () => {
        for (const half of tableTennisPad(expedited).halves) {
          expect(half.marks).toEqual({
            clock: true,
            cards: [],
            said: [{ key: 'scoring.tabletennis.half.expedite' }],
          });
        }
      });

      it.each(['offered', 'off'] as const)('draws none while Expedite is only %s', (expedite) => {
        expect(marks(tableTennisPad({ ...live, expedite }))).toEqual([NONE, NONE]);
      });

      it('keeps it between games', () => {
        const view = tableTennisPad({ ...expedited, phase: 'betweenGames' });
        expect(view.halves.map((half) => half.marks.clock)).toEqual([true, true]);
        expect(view.halves.map((half) => half.marks.said)).toEqual([
          [{ key: 'scoring.tabletennis.half.expedite' }],
          [{ key: 'scoring.tabletennis.half.expedite' }],
        ]);
      });

      // The controller's ruling (Task 8c fix round 1): a finished match has no serve rule in force, so the stopwatch goes
      // as the serving plate does, and the half's name stops saying Expedite. A card stays: it is the umpire's record.
      it('goes once the match is decided, on both halves, and the halves’ names stop saying Expedite', () => {
        const view = tableTennisPad({ ...expedited, phase: 'decided' });
        expect(marks(view)).toEqual([NONE, NONE]);
      });

      it('goes once the match is decided, and a card still stands', () => {
        const view = sanctioned(
          { ...expedited, phase: 'decided' },
          { side: 'first', level: 'penalty' },
        );
        expect(view.halves[0].marks).toEqual({
          clock: false,
          cards: ['caution', 'dismissal'],
          said: [{ key: 'scoring.tabletennis.card.penalty' }],
        });
        expect(view.halves[1].marks).toEqual(NONE);
      });

      it('is drawn before the card, and a screen reader hears the card’s name before Expedite', () => {
        const view = sanctioned(expedited, { side: 'second', level: 'penalty' });
        expect(view.halves[1].marks).toEqual({
          clock: true,
          cards: ['caution', 'dismissal'],
          said: [
            { key: 'scoring.tabletennis.card.penalty' },
            { key: 'scoring.tabletennis.half.expedite' },
          ],
        });
        expect(view.halves[0].marks.cards).toEqual([]);
      });

      // The half has its own key, not the Expedite cell's `tool.expediteSaid`, so either can change alone. Both say the
      // full term (nothing is drawn, so no width limits it): not the strip's old shortened es word, Aceleración.
      it('says Expedite in the language’s full term, under its own key', () => {
        expect(en['scoring.tabletennis.half.expedite']).toBe('Expedite');
        expect(es['scoring.tabletennis.half.expedite']).toBe('Sistema de aceleración');
        expect(fr['scoring.tabletennis.half.expedite']).toBe('Système accéléré');
        expect(nl['scoring.tabletennis.half.expedite']).toBe('Versnelling');
      });
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

  it('tells a screen reader that a tap awards the point', () => {
    expect(tableTennisPad(live).halves.map((half) => half.hint)).toEqual([
      { key: 'scoring.tabletennis.hint' },
      { key: 'scoring.tabletennis.hint' },
    ]);
    expect(en['scoring.tabletennis.hint']).toBe('Tap to award the point');
  });

  // Owner ruling 56 (2026-11-04): "bottom right, just tap Tap?" The visible hint is the one word "Tap", no side name; the
  // kit says it, so a half carries no hint line of its own (ruling 14's "Tap: point to …" is superseded).
  it('carries no visible hint line: the kit says the one word', () => {
    for (const half of tableTennisPad(doubles).halves) expect('hintLine' in half).toBe(false);
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

  // Design §5.2, ruling 56: one note at the right, “Deuce” or nothing. Expedite is the clock on both halves now, not a word.
  describe('the note: Deuce, or nothing', () => {
    const note = (display: TableTennisDisplay) => tableTennisPad(display).strip[1]?.text;

    it('says Deuce at a level endgame score', () => {
      expect(note({ ...live, deuce: true })).toEqual({ key: 'scoring.tabletennis.note.deuce' });
      expect(en['scoring.tabletennis.note.deuce']).toBe('Deuce');
    });

    it('says nothing of Expedite, in force or not: its clock is on the halves', () => {
      expect(note(expedited)).toBeNull();
      expect(note({ ...expedited, phase: 'betweenGames' })).toBeNull();
      expect(note({ ...live, expedite: 'offered' })).toBeNull();
      expect(note({ ...live, expedite: 'off' })).toBeNull();
    });

    it('says Deuce under Expedite: the strip’s one note is not taken by it', () => {
      expect(note({ ...expedited, deuce: true })).toEqual({
        key: 'scoring.tabletennis.note.deuce',
      });
    });

    it('says nothing without a deuce', () => {
      expect(note(live)).toBeNull();
    });

    it('says nothing once the match is decided, whatever the engine still holds', () => {
      expect(note({ ...expedited, deuce: true, phase: 'decided' })).toBeNull();
    });

    it('has no Expedite word in any dictionary: the key is gone with the note', () => {
      for (const dictionary of [en, es, fr, nl]) {
        expect(Object.keys(dictionary)).not.toContain('scoring.tabletennis.note.expedite');
      }
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
