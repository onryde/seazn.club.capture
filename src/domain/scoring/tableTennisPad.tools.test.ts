import { describe, expect, it } from 'vitest';
import type { PadView } from '@/domain/scoring/padView';
import {
  parseTableTennisTool,
  tableTennisExpediteConfirm,
  tableTennisExpediteOffered,
  tableTennisMoreItems,
  tableTennisMoreOptions,
  tableTennisPad,
  tableTennisSetScoreOffered,
  type TableTennisDisplay,
} from '@/domain/scoring/tableTennisPad';
import { pre, live, unanchored, expedited, doubles } from '@/domain/scoring/tableTennisPad.testkit';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';

const ids = (view: PadView<string>) => view.tools.map((tool) => tool.id);
/** The 13 returns cell, if any: its id names the receiver it was drawn for (`returns.first`, `returns.second`). */
const returnsCell = (view: PadView<string>) =>
  view.tools.find((tool) => tool.id.startsWith('returns.'));

// Task 8 fix round 1 (the controller's sheet-title ruling), and Task 8b: a cell that shortens a word to fit the row (the
// Expedite cell, drawn "Exped.") is read to a screen reader as the full term, and the sheets they open say the full words.
// The copy is pinned here by hand, in all four languages, apart from the cells' shortened `tool.*` copy, which
// padFit.test.ts measures.
describe('tableTennisPad: the sheets say the full words the cells shorten', () => {
  const full = {
    en: { card: 'Card', serving: 'Who is serving?', expedite: 'Expedite' },
    es: { card: 'Tarjeta', serving: '¿Quién saca?', expedite: 'Sistema de aceleración' },
    fr: { card: 'Carton', serving: 'Qui sert ?', expedite: 'Système accéléré' },
    nl: { card: 'Kaart', serving: 'Wie serveert?', expedite: 'Versnelling' },
  } as const;

  it.each(Object.entries({ en, es, fr, nl }))(
    '%s: the Card sheet is titled with the full word, Who is serving? with ruling 51’s words, and the Expedite cell is spoken as the full term',
    (name, dictionary: Record<string, string>) => {
      const words = full[name as keyof typeof full];
      expect(dictionary['scoring.tabletennis.sheet.card']).toBe(words.card);
      expect(dictionary['scoring.tabletennis.sheet.serving']).toBe(words.serving);
      expect(dictionary['scoring.tabletennis.tool.expediteSaid']).toBe(words.expedite);
    },
  );

  it('gives the Expedite cell the full term to a screen reader in every row, and the other cells theirs only when crowded', () => {
    const cells = (display: TableTennisDisplay) =>
      tableTennisPad(display).tools.map((tool) => [tool.id, tool.said]);
    // Three cells or fewer: only Expedite has a spoken name (its drawn word is itself shortened in es and nl).
    expect(cells(unanchored)).toEqual([
      ['expedite', { key: 'scoring.tabletennis.tool.expediteSaid' }],
      ['serving', undefined],
      ['more', undefined],
    ]);
    // Four cells: Set score and Who is serving? are drawn short, and a screen reader hears their full words all the same.
    expect(
      cells({ ...pre, server: null, serveNumber: null, serverPicked: false, anchorNeeded: true }),
    ).toEqual([
      ['setScore', { key: 'scoring.tabletennis.tool.setScore' }],
      ['expedite', { key: 'scoring.tabletennis.tool.expediteSaid' }],
      ['serving', { key: 'scoring.tabletennis.tool.serving' }],
      ['more', undefined],
    ]);
  });
});

// The controller's Task 8b follow-up rulings: a cell word is the fullest that fits the row it stands in. A row of four cells
// leaves a word 48 dp at 320; three or fewer leave 72.67 or more. So Set score, Expedite and Who is serving? have two
// words each: the full one (three cells or fewer) and a short one (a row of four, the rare state in which Set score,
// Expedite, Who is serving? and More stand together), both measured in padFit.test.ts.
describe('tableTennisPad: a cell word by the number of cells in its row', () => {
  const TOOL = 'scoring.tabletennis.tool';
  /** Started elsewhere, no first server named, before the game's first point: the one row of four. */
  const unanchoredPre: TableTennisDisplay = {
    ...pre,
    server: null,
    serveNumber: null,
    serverPicked: false,
    anchorNeeded: true,
  };
  const labels = (display: TableTennisDisplay) =>
    tableTennisPad(display).tools.map((tool) => [tool.id, tool.label.key]);

  it('draws the short words in the row of four, and More as always', () => {
    expect(labels(unanchoredPre)).toEqual([
      ['setScore', `${TOOL}.setScoreShort`],
      ['expedite', `${TOOL}.expediteShort`],
      ['serving', `${TOOL}.servingShort`],
      ['more', `${TOOL}.more`],
    ]);
  });

  it.each([
    ['Set score, Expedite and More (the server named)', pre, ['setScore', 'expedite', 'more']],
    [
      'Expedite, Who is serving? and More (a game under way)',
      unanchored,
      ['expedite', 'serving', 'more'],
    ],
    [
      'Set score, Who is serving? and More (Expedite not offered)',
      { ...unanchoredPre, expedite: 'off' },
      ['setScore', 'serving', 'more'],
    ],
    ['Expedite and More', live, ['expedite', 'more']],
  ] as const)('draws the full words in a row of three or fewer: %s', (_name, display, row) => {
    expect(labels(display).map(([id]) => id)).toEqual(row);
    expect(labels(display)).toEqual(row.map((id) => [id, `${TOOL}.${id}`]));
  });

  it('names a row by its final cells: a fourth cell shortens the others, and one fewer gives them back', () => {
    // The same display, with and without the More cell (a match that records neither cards nor timeouts).
    const noMore = {
      ...unanchoredPre,
      records: { timeouts: false, sanctions: false, expedite: true },
    };
    expect(labels(noMore)).toEqual([
      ['setScore', `${TOOL}.setScore`],
      ['expedite', `${TOOL}.expedite`],
      ['serving', `${TOOL}.serving`],
    ]);
  });

  // The words, by hand, in four languages. The full Set score words are the Set score sheet's own (ruling 2: one verb
  // for the cell and the sheet); the full Who is serving? words are the Who is serving? sheet's; the full Expedite word
  // is the web's term where it fits three cells (en, fr) and its truncation where it does not (es, nl: padFit).
  const words = {
    en: {
      setScore: ['Set score', 'Set score'],
      expedite: ['Expedite', 'Exped.'],
      serving: ['Who is serving?', 'Whose serve?'],
    },
    es: {
      setScore: ['Fijar puntos', 'Fijar tanteo'],
      expedite: ['Aceler.', 'Sist. acel.'],
      serving: ['¿Quién saca?', '¿Quién saca?'],
    },
    fr: {
      setScore: ['Saisir le score', 'Saisir score'],
      expedite: ['Système accéléré', 'Syst. accél.'],
      serving: ['Qui sert\u00a0?', 'Qui sert\u00a0?'],
    },
    nl: {
      setScore: ['Stand invoeren', 'Stand zetten'],
      expedite: ['Versnel.', 'Versn.'],
      serving: ['Wie serveert?', 'Wiens serve?'],
    },
  } as const;

  it.each(Object.entries({ en, es, fr, nl }))(
    '%s: the full and the short word of each cell',
    (name, dictionary: Record<string, string>) => {
      const mine = words[name as keyof typeof words];
      for (const cell of ['setScore', 'expedite', 'serving'] as const) {
        expect(dictionary[`${TOOL}.${cell}`], cell).toBe(mine[cell][0]);
        expect(dictionary[`${TOOL}.${cell}Short`], `${cell}Short`).toBe(mine[cell][1]);
      }
    },
  );

  it.each(Object.entries({ en, es, fr, nl }))(
    '%s: the full Set score word is the Set score sheet’s own verb and noun',
    (_name, dictionary: Record<string, string>) => {
      const sheet = (dictionary['scoring.setScore.title'] ?? '').split(' · ')[0];
      expect(dictionary[`${TOOL}.setScore`]).toBe(sheet);
    },
  );

  it.each(Object.entries({ en, es, fr, nl }))(
    '%s: the full Who is serving? word is the sheet’s title',
    (_name, dictionary: Record<string, string>) => {
      expect(dictionary[`${TOOL}.serving`]).toBe(dictionary['scoring.tabletennis.sheet.serving']);
    },
  );
});

// Owner rulings 54 and 55 (2026-11-04, supersedes ruling 52's cells) and design §5.3: one row, at most four cells, in
// order. This is the acceptance table, a row at a time; the expected ids and words are the table's, never the code's.
describe('tableTennisPad: the tools', () => {
  const betweenGames: TableTennisDisplay = { ...live, phase: 'betweenGames' };
  /** Started elsewhere, no first server named, before the game's first point: the row's fullest state. */
  const unanchoredPre: TableTennisDisplay = {
    ...pre,
    server: null,
    serveNumber: null,
    serverPicked: false,
    anchorNeeded: true,
  };

  describe('Set score: when More listed it before, the game’s first point not yet played', () => {
    it('is the first cell before the match’s first point and between games, a plain outline', () => {
      expect(tableTennisPad(pre).tools[0]).toEqual({
        id: 'setScore',
        label: { key: 'scoring.tabletennis.tool.setScore' },
        detail: null,
        kind: 'standard',
        enabled: true,
      });
      expect(ids(tableTennisPad(betweenGames))[0]).toBe('setScore');
      expect(en['scoring.tabletennis.tool.setScore']).toBe('Set score');
    });

    it('is gone after the game’s first point, and for a game under way', () => {
      expect(ids(tableTennisPad(live))).not.toContain('setScore');
      expect(ids(tableTennisPad({ ...live, points: { first: 1, second: 0 } }))).not.toContain(
        'setScore',
      );
    });

    it('is not drawn on the Start screen or once the match is decided', () => {
      expect(tableTennisPad({ ...pre, phase: 'notStarted' }).tools).toEqual([]);
      expect(ids(tableTennisPad({ ...pre, phase: 'decided' }))).toEqual([]);
    });

    it('does not depend on what the match records: no timeouts, no cards, no Expedite', () => {
      const records = { timeouts: false, sanctions: false, expedite: false };
      expect(ids(tableTennisPad({ ...pre, expedite: 'off', records }))).toEqual(['setScore']);
    });
  });

  describe('Expedite: when More listed it before, and it is not in force (ruling 55)', () => {
    it('is a cell after Set score, a plain outline, drawn shortened and spoken as the full term', () => {
      const cell = tableTennisPad(live).tools[0];
      expect(cell).toEqual({
        id: 'expedite',
        label: { key: 'scoring.tabletennis.tool.expedite' },
        said: { key: 'scoring.tabletennis.tool.expediteSaid' },
        detail: null,
        kind: 'standard',
        enabled: true,
      });
      expect(ids(tableTennisPad(pre)).slice(0, 2)).toEqual(['setScore', 'expedite']);
    });

    it('is gone once Expedite is in force, and when it cannot be started', () => {
      expect(ids(tableTennisPad(expedited))).not.toContain('expedite');
      expect(ids(tableTennisPad({ ...live, expedite: 'off' }))).not.toContain('expedite');
    });

    it('is gone when the match does not record Expedite', () => {
      const records = { ...live.records, expedite: false };
      expect(ids(tableTennisPad({ ...live, expedite: 'off', records }))).not.toContain('expedite');
    });

    it('is not drawn on the Start screen or once the match is decided', () => {
      expect(ids(tableTennisPad({ ...live, phase: 'decided' }))).toEqual([]);
      expect(ids(tableTennisPad({ ...pre, phase: 'notStarted' }))).toEqual([]);
    });
  });

  describe('13 returns · {receiver}: Expedite in force, the server known (rulings 50 and 54)', () => {
    it('gives the receiving side the point, and says the receiver beneath: the server’s opponent', () => {
      const returns = returnsCell(tableTennisPad(expedited));
      expect(returns).toEqual({
        id: 'returns.first',
        label: { key: 'scoring.tabletennis.tool.returns', vars: { returns: 13 } },
        detail: 'A. Sharma',
        kind: 'standard',
        enabled: true,
      });
      // The full term comes back (ruling 54): at most three cells share its row, which leaves it 72.67 dp at 320.
      expect(en['scoring.tabletennis.tool.returns']).toBe('{returns} returns');
    });

    it('takes the Expedite cell’s place once Expedite is on: the first cell of a game under way', () => {
      expect(ids(tableTennisPad(live))).toEqual(['expedite', 'more']);
      expect(ids(tableTennisPad(expedited))).toEqual(['returns.first', 'more']);
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
      const serving = tableTennisPad(unanchored).tools.find((tool) => tool.id === 'serving');
      expect(serving).toEqual({
        id: 'serving',
        label: { key: 'scoring.tabletennis.tool.serving' },
        detail: null,
        kind: 'standard',
        enabled: true,
      });
      // The owner's "Who is serving?" (ruling 51) in full, in a row of three or fewer; a row of four shortens it
      // (`servingShort`, the describe below).
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

  it('never offers Expedite and 13 returns together: Expedite is either offered or in force', () => {
    for (const display of [pre, live, expedited, unanchored, unanchoredPre, betweenGames]) {
      const row = ids(tableTennisPad(display));
      expect(row.includes('expedite') && row.some((id) => id.startsWith('returns.'))).toBe(false);
    }
  });

  describe('More: live, and the sheet has at least one item (cards and timeouts)', () => {
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

    it('is not drawn when nothing is in it: no timeouts and no cards', () => {
      const bare: TableTennisDisplay = {
        ...live,
        expedite: 'off',
        records: { timeouts: false, sanctions: false, expedite: false },
      };
      expect(tableTennisMoreItems(bare)).toEqual([]);
      expect(ids(tableTennisPad(bare))).toEqual([]);
    });

    it('is drawn for the cards alone, or the timeouts alone', () => {
      const cards = { timeouts: false, sanctions: true, expedite: false };
      const timeouts = { timeouts: true, sanctions: false, expedite: false };
      expect(ids(tableTennisPad({ ...live, expedite: 'off', records: cards }))).toEqual(['more']);
      expect(ids(tableTennisPad({ ...live, expedite: 'off', records: timeouts }))).toEqual([
        'more',
      ]);
    });

    it('is not drawn for Set score or Expedite alone: they are cells of their own, not More’s', () => {
      const none = { timeouts: false, sanctions: false, expedite: true };
      expect(ids(tableTennisPad({ ...pre, records: none }))).toEqual(['setScore', 'expedite']);
    });
  });

  it('puts the cells in order: Set score, Expedite, 13 returns or Who is serving?, then More: four at most', () => {
    expect(ids(tableTennisPad(unanchoredPre))).toEqual(['setScore', 'expedite', 'serving', 'more']);
    expect(ids(tableTennisPad(pre))).toEqual(['setScore', 'expedite', 'more']);
    expect(ids(tableTennisPad({ ...expedited, phase: 'betweenGames' }))).toEqual([
      'setScore',
      'returns.first',
      'more',
    ]);
    expect(ids(tableTennisPad(unanchored))).toEqual(['expedite', 'serving', 'more']);
    for (const display of [
      live,
      expedited,
      unanchored,
      unanchoredPre,
      doubles,
      pre,
      betweenGames,
    ]) {
      expect(tableTennisPad(display).tools.length).toBeLessThanOrEqual(4);
    }
  });

  it('reads its own tool ids back, and nothing else', () => {
    expect(parseTableTennisTool('setScore')).toEqual({ setScore: true });
    expect(parseTableTennisTool('expedite')).toEqual({ expedite: true });
    expect(parseTableTennisTool('returns.first')).toEqual({ returns: 'first' });
    expect(parseTableTennisTool('returns.second')).toEqual({ returns: 'second' });
    expect(parseTableTennisTool('serving')).toEqual({ serving: true });
    expect(parseTableTennisTool('more')).toEqual({ more: true });
    // The Card cells are gone (ruling 54): a card is a More item, not a tool.
    for (const id of [
      '',
      'card',
      'card.first',
      'card.second',
      'card.third',
      'undo',
      'MORE',
      'sanction.first',
      'Expedite',
      'set-score',
      'returns',
      'returns.third',
      'returns.',
    ]) {
      expect(parseTableTennisTool(id), id).toBeNull();
    }
  });

  it('reads back every id the pad gives', () => {
    for (const display of [live, expedited, unanchored, unanchoredPre, pre, betweenGames]) {
      for (const id of ids(tableTennisPad(display))) {
        expect(parseTableTennisTool(id), id).not.toBeNull();
      }
    }
  });
});

describe('tableTennisSetScoreOffered and tableTennisExpediteOffered: the sheets’ stale checks', () => {
  it('offers Set score before a game’s first point: before the match’s, and between games', () => {
    expect(tableTennisSetScoreOffered(pre)).toBe(true);
    expect(tableTennisSetScoreOffered({ ...live, phase: 'betweenGames' })).toBe(true);
  });

  it('offers no Set score once a game is under way, on the Start screen or when decided', () => {
    expect(tableTennisSetScoreOffered(live)).toBe(false);
    expect(tableTennisSetScoreOffered({ ...pre, phase: 'notStarted' })).toBe(false);
    expect(tableTennisSetScoreOffered({ ...pre, phase: 'decided' })).toBe(false);
  });

  it('offers Expedite while the display says it is offered, and only then', () => {
    expect(tableTennisExpediteOffered(live)).toBe(true);
    expect(tableTennisExpediteOffered(pre)).toBe(true);
    expect(tableTennisExpediteOffered(expedited)).toBe(false);
    expect(tableTennisExpediteOffered({ ...live, expedite: 'off' })).toBe(false);
    expect(tableTennisExpediteOffered({ ...live, phase: 'decided' })).toBe(false);
    expect(tableTennisExpediteOffered({ ...pre, phase: 'notStarted' })).toBe(false);
  });
});

describe('tableTennisMoreItems: what the More sheet lists (design §4, §5.3; ruling 54)', () => {
  it('lists a Card for each side, then a timeout for each, in a game under way', () => {
    expect(tableTennisMoreItems(live)).toEqual([
      'card.first',
      'card.second',
      'timeout.first',
      'timeout.second',
    ]);
  });

  it('lists the same before a game’s first point and between games: Set score and Expedite are cells', () => {
    const same = ['card.first', 'card.second', 'timeout.first', 'timeout.second'];
    expect(tableTennisMoreItems(pre)).toEqual(same);
    expect(tableTennisMoreItems({ ...live, phase: 'betweenGames' })).toEqual(same);
    expect(tableTennisMoreItems(expedited)).toEqual(same);
  });

  it('drops the cards when the match does not record them', () => {
    const records = { ...live.records, sanctions: false };
    expect(tableTennisMoreItems({ ...live, records })).toEqual(['timeout.first', 'timeout.second']);
  });

  it('drops the timeouts when the match does not record them', () => {
    const records = { ...live.records, timeouts: false };
    expect(tableTennisMoreItems({ ...live, records })).toEqual(['card.first', 'card.second']);
  });

  it('lists nothing on the Start screen or once the match is decided', () => {
    expect(tableTennisMoreItems({ ...pre, phase: 'notStarted' })).toEqual([]);
    expect(tableTennisMoreItems({ ...live, phase: 'decided' })).toEqual([]);
  });
});

describe('tableTennisMoreOptions: the sheet’s choices, in words', () => {
  it('says a card and a timeout with their side, the full words, in the list’s order', () => {
    expect(tableTennisMoreOptions(pre)).toEqual([
      {
        id: 'card.first',
        label: { key: 'scoring.tabletennis.more.card', vars: { side: 'A. Sharma' } },
      },
      {
        id: 'card.second',
        label: { key: 'scoring.tabletennis.more.card', vars: { side: 'L. Chen' } },
      },
      {
        id: 'timeout.first',
        label: { key: 'scoring.tabletennis.more.timeout', vars: { side: 'A. Sharma' } },
      },
      {
        id: 'timeout.second',
        label: { key: 'scoring.tabletennis.more.timeout', vars: { side: 'L. Chen' } },
      },
    ]);
  });

  it('says them in all four languages, as the owner’s ruling 54 words them', () => {
    expect(
      [en, es, fr, nl].map((d) => [
        d['scoring.tabletennis.more.card'],
        d['scoring.tabletennis.more.timeout'],
      ]),
    ).toEqual([
      ['Card · {side}', 'Timeout · {side}'],
      ['Tarjeta · {side}', 'Tiempo muerto · {side}'],
      ['Carton · {side}', 'Temps mort · {side}'],
      ['Kaart · {side}', 'Time-out · {side}'],
    ]);
  });

  it('names a doubles side as its partners joined', () => {
    expect(tableTennisMoreOptions(doubles)[0]?.label).toEqual({
      key: 'scoring.tabletennis.more.card',
      vars: { side: 'A. Sharma / R. Iyer' },
    });
  });

  it('lists exactly what tableTennisMoreItems lists', () => {
    for (const display of [pre, live, expedited, { ...live, phase: 'decided' } as const]) {
      expect(tableTennisMoreOptions(display).map((option) => option.id)).toEqual(
        tableTennisMoreItems(display),
      );
    }
  });
});

// Ruling 55 (owner, 2026-11-04, "Confirm sheet (Recommended)"): a tap on the Expedite cell asks first. The words are the
// owner's, in four languages; Cancel is the kit's.
describe('tableTennisExpediteConfirm: Start Expedite? (ruling 55)', () => {
  it('asks the question, says it stays on, and offers one choice, Start', () => {
    expect(tableTennisExpediteConfirm).toEqual({
      title: { key: 'scoring.tabletennis.expedite.title' },
      body: { key: 'scoring.tabletennis.expedite.body' },
      options: [{ id: 'start', label: { key: 'scoring.tabletennis.expedite.start' } }],
    });
  });

  it.each([
    ['en', en, ['Start Expedite?', 'It stays on for the rest of the match.', 'Start']],
    [
      'es',
      es,
      [
        '¿Iniciar el sistema de aceleración?',
        'Sigue activo hasta el final del partido.',
        'Iniciar',
      ],
    ],
    [
      'fr',
      fr,
      ['Lancer le système accéléré ?', "Il reste actif jusqu'à la fin du match.", 'Lancer'],
    ],
    [
      'nl',
      nl,
      ['Versnelling starten?', 'Het blijft aan tot het einde van de wedstrijd.', 'Starten'],
    ],
  ] as const)(
    '%s: says it in its own words',
    (_lang, dictionary: Record<string, string>, words) => {
      expect([
        dictionary['scoring.tabletennis.expedite.title'],
        dictionary['scoring.tabletennis.expedite.body'],
        dictionary['scoring.tabletennis.expedite.start'],
      ]).toEqual(words);
    },
  );
});
