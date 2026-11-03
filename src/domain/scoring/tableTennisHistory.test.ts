import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import nl from '@/i18n/nl.json';
import { translatePad } from '@/i18n/padText';
import { createTranslator } from '@/i18n/translate';
import type { PadHistoryGroup } from '@/domain/scoring/padView';
import { foldTableTennis } from '@/domain/scoring/tableTennisFold';
import { doneOf, namesOf } from '@/domain/scoring/tableTennisLedgerHistory';
import {
  doneSaid,
  tableTennisHistory,
  type TableTennisHistoryEntry,
} from '@/domain/scoring/tableTennisHistory';
import type {
  TableTennisDisplay,
  TableTennisDone,
  TableTennisPadKey,
} from '@/domain/scoring/tableTennisPad';
import {
  DECIDED_3_0,
  GAME_ONE_11_7,
  SINGLES,
  anchored,
  expedite,
  ledgerOf,
  queuedOf,
  rallies,
  rally,
  sanction,
  start,
  summary,
  timeout,
  voiding,
  type Spec,
} from '../../../test/tableTennisLedger';

// Owner ruling 21 (2026-10-31), History, view only, for table tennis (plan S2-2 Task 3): newest first, grouped by game
// ("Game 2", "Game 1"); one row per entry with what it did in the last-tap line's words, the score after it where it
// applies, who recorded it, and an entry Undo took back left in its place. The expected keys are the dictionary's
// (`scoring.tabletennis.last.*`), the scores the ruling's form ("7–3", top first).

const SIDES: TableTennisDisplay['sides'] = {
  first: { players: ['A. Sharma'] },
  second: { players: ['L. Chen'] },
};

const point = (
  side: 'first' | 'second',
  game: number,
  after: readonly [number, number],
  more: Partial<Pick<TableTennisHistoryEntry, 'own' | 'undone' | 'sending'>> & {
    readonly won?: 'none' | 'game' | 'match';
  } = {},
): TableTennisHistoryEntry => ({
  did: { kind: 'rally', side, won: more.won ?? 'none', game },
  game,
  after: { first: after[0], second: after[1] },
  own: more.own ?? true,
  undone: more.undone ?? false,
  sending: more.sending ?? false,
});

describe('tableTennisHistory', () => {
  it('lists nothing when nothing is recorded', () => {
    expect(tableTennisHistory([], SIDES)).toEqual([]);
  });

  it('groups by game, the latest game first and each game’s newest entry first', () => {
    const groups = tableTennisHistory(
      [
        point('first', 1, [1, 0], { own: false }),
        point('first', 1, [11, 9], { won: 'game' }),
        point('second', 2, [0, 1]),
        point('first', 2, [1, 1]),
      ],
      SIDES,
    );
    expect(groups.map((group) => group.heading)).toEqual([
      { key: 'scoring.tabletennis.gameHeading', vars: { game: 2 } },
      { key: 'scoring.tabletennis.gameHeading', vars: { game: 1 } },
    ]);
    expect(groups.map((group) => group.rows.map((row) => row.score))).toEqual([
      ['1–1', '0–1'],
      ['11–9', '1–0'],
    ]);
  });

  it('marks who recorded each entry, an undone one in its place, and a tap still on its way', () => {
    const [game1] = tableTennisHistory(
      [
        point('first', 1, [1, 0], { own: false }),
        point('second', 1, [1, 1], { undone: true }),
        point('first', 1, [2, 1], { sending: true }),
      ],
      SIDES,
    );
    expect(game1?.rows.map((row) => [row.by, row.undone, row.sending])).toEqual([
      ['thisPhone', false, true],
      ['thisPhone', true, false],
      ['otherScorer', false, false],
    ]);
  });

  it('gives a score to a point and a 13 returns point, and to nothing else', () => {
    const dones: readonly TableTennisDone[] = [
      { kind: 'start', server: 'first' },
      { kind: 'rally', side: 'first', won: 'none', game: 1 },
      { kind: 'returns', side: 'second', won: 'none', game: 1, returns: 13 },
      { kind: 'timeout', side: 'first' },
      { kind: 'expedite' },
      { kind: 'sanction', side: 'second', level: 'warning', person: 'L. Chen' },
      { kind: 'setScore', first: 5, second: 3 },
    ];
    const entries = dones.map((did) => ({
      did,
      game: 1,
      after: { first: 4, second: 2 },
      own: true,
      undone: false,
      sending: false,
    }));
    const rows = tableTennisHistory(entries, SIDES)[0]?.rows ?? [];
    expect(rows.map((row) => row.score).reverse()).toEqual([
      null,
      '4–2',
      '4–2',
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('doneSaid: what a tap did, in the dictionary’s keys', () => {
  type Said = ReturnType<typeof doneSaid>;
  const cases: readonly [string, TableTennisDone, Said][] = [
    [
      'the start, its server named',
      { kind: 'start', server: 'second' },
      { key: 'scoring.tabletennis.last.start', vars: { side: 'L. Chen' } },
    ],
    [
      'the start, no server',
      { kind: 'start', server: null },
      { key: 'scoring.tabletennis.last.startUnknownServer' },
    ],
    [
      'a point',
      { kind: 'rally', side: 'first', won: 'none', game: 1 },
      { key: 'scoring.tabletennis.last.rally', vars: { side: 'A. Sharma' } },
    ],
    [
      'a game',
      { kind: 'rally', side: 'second', won: 'game', game: 2 },
      { key: 'scoring.tabletennis.last.game', vars: { game: 2, side: 'L. Chen' } },
    ],
    [
      'the match',
      { kind: 'rally', side: 'first', won: 'match', game: 3 },
      { key: 'scoring.tabletennis.last.match', vars: { side: 'A. Sharma' } },
    ],
    [
      'a timeout',
      { kind: 'timeout', side: 'second' },
      { key: 'scoring.tabletennis.last.timeout', vars: { side: 'L. Chen' } },
    ],
    ['Expedite', { kind: 'expedite' }, { key: 'scoring.tabletennis.last.expedite' }],
    [
      'a set score',
      { kind: 'setScore', first: 11, second: 7 },
      { key: 'scoring.tabletennis.last.setScore', vars: { score: '11–7' } },
    ],
  ];

  it.each(cases)('%s', (_name, did, expected) => {
    expect(doneSaid(SIDES, did)).toEqual(expected);
  });

  it('says a card as its level’s word and the player', () => {
    expect(
      doneSaid(SIDES, { kind: 'sanction', side: 'first', level: 'penalty', person: 'A. Sharma' }),
    ).toEqual({
      key: 'scoring.tabletennis.last.sanction',
      vars: { level: { key: 'scoring.tabletennis.card.penalty' }, person: 'A. Sharma' },
    });
    expect(
      doneSaid(SIDES, { kind: 'sanction', side: 'first', level: 'warning', person: 'A. Sharma' }),
    ).toMatchObject({ vars: { level: { key: 'scoring.tabletennis.card.warning' } } });
  });

  it('says a 13 returns point as its point first, then the returns it carried', () => {
    expect(
      doneSaid(SIDES, { kind: 'returns', side: 'second', won: 'game', game: 1, returns: 13 }),
    ).toEqual({
      key: 'scoring.tabletennis.last.returns',
      vars: {
        point: { key: 'scoring.tabletennis.last.game', vars: { game: 1, side: 'L. Chen' } },
        returns: 13,
      },
    });
  });
});

function history(
  specs: readonly Spec[],
  more: { readonly own?: readonly string[]; readonly queued?: Parameters<typeof queuedOf>[] } = {},
): readonly PadHistoryGroup<TableTennisPadKey>[] {
  const result = foldTableTennis({
    bootstrap: SINGLES,
    ledger: ledgerOf(specs),
    queued: (more.queued ?? []).map(([key, spec]) => queuedOf(key, spec)),
    ownEventIds: more.own ?? [],
    toss: null,
  });
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result.history;
}

const english = createTranslator('en');
const dutch = createTranslator('nl');
const said = (
  translator: typeof english,
  row: PadHistoryGroup<TableTennisPadKey>['rows'][number],
) => translatePad(translator, row.said);

describe('tableTennisHistory: from the ledger, in English and Dutch', () => {
  // seq: 1 start, 2 point (home serving: the anchor), 3 timeout, 4 red card with no player, 5 Expedite,
  // 6 a 13 returns point for home, 7 a point for away that seq 8 voids; then this phone's queued point.
  const ledger: readonly Spec[] = [
    start(),
    rally({ wonBy: 'H', serving: 'H' }),
    timeout('A'),
    sanction('A', 'penalty'),
    expedite(),
    rally({ wonBy: 'H', returns: 13 }),
    rally({ wonBy: 'A' }),
    voiding(7),
  ];
  const groups = history(ledger, {
    own: ['ev-2', 'ev-6'],
    queued: [['k1', rally({ wonBy: 'H' })]],
  });
  const rows = groups[0]?.rows ?? [];

  it('lists one game, newest first, with a row for every event the pad has words for and none for the void', () => {
    expect(groups).toHaveLength(1);
    expect(groups[0]?.heading).toEqual({
      key: 'scoring.tabletennis.gameHeading',
      vars: { game: 1 },
    });
    expect(rows.map((row) => [row.score, row.by, row.undone, row.sending])).toEqual([
      ['3–0', 'thisPhone', false, true], // this phone's queued point
      ['2–1', 'otherScorer', true, false], // the point seq 8 took back, with the score it left
      ['2–0', 'thisPhone', false, false],
      [null, 'otherScorer', false, false],
      [null, 'otherScorer', false, false],
      [null, 'otherScorer', false, false],
      ['1–0', 'thisPhone', false, false],
      [null, 'otherScorer', false, false],
    ]);
  });

  it('says each row in English', () => {
    expect(rows.map((row) => said(english, row))).toEqual([
      en['scoring.tabletennis.last.rally'].replace('{side}', 'A. Sharma'),
      en['scoring.tabletennis.last.rally'].replace('{side}', 'L. Chen'),
      en['scoring.tabletennis.last.returns']
        .replace('{point}', en['scoring.tabletennis.last.rally'].replace('{side}', 'A. Sharma'))
        .replace('{returns}', '13'),
      en['scoring.tabletennis.last.expedite'],
      en['scoring.tabletennis.last.sanction']
        .replace('{level}', en['scoring.tabletennis.card.penalty'])
        .replace('{person}', 'L. Chen'),
      en['scoring.tabletennis.last.timeout'].replace('{side}', 'L. Chen'),
      en['scoring.tabletennis.last.rally'].replace('{side}', 'A. Sharma'),
      en['scoring.tabletennis.last.start'].replace('{side}', 'A. Sharma'),
    ]);
  });

  it('says each row in Dutch, and not in English', () => {
    const inDutch = rows.map((row) => said(dutch, row));
    expect(inDutch).toEqual([
      nl['scoring.tabletennis.last.rally'].replace('{side}', 'A. Sharma'),
      nl['scoring.tabletennis.last.rally'].replace('{side}', 'L. Chen'),
      nl['scoring.tabletennis.last.returns']
        .replace('{point}', nl['scoring.tabletennis.last.rally'].replace('{side}', 'A. Sharma'))
        .replace('{returns}', '13'),
      nl['scoring.tabletennis.last.expedite'],
      nl['scoring.tabletennis.last.sanction']
        .replace('{level}', nl['scoring.tabletennis.card.penalty'])
        .replace('{person}', 'L. Chen'),
      nl['scoring.tabletennis.last.timeout'].replace('{side}', 'L. Chen'),
      nl['scoring.tabletennis.last.rally'].replace('{side}', 'A. Sharma'),
      nl['scoring.tabletennis.last.start'].replace('{side}', 'A. Sharma'),
    ]);
    const inEnglish = rows.map((row) => said(english, row));
    expect(inDutch.filter((text, at) => text === inEnglish[at])).toEqual([]);
  });

  it('says a 13 returns point that wins the game as the game, then the returns', () => {
    const ledgerWin = [
      ...anchored('H', 'H'.repeat(9)),
      expedite(),
      rally({ wonBy: 'H', returns: 13 }),
    ];
    const [game1] = history(ledgerWin);
    const top = game1?.rows[0];
    expect(top?.score).toBe('11–0');
    expect(top?.said).toEqual({
      key: 'scoring.tabletennis.last.returns',
      vars: {
        point: { key: 'scoring.tabletennis.last.game', vars: { game: 1, side: 'A. Sharma' } },
        returns: 13,
      },
    });
  });

  it('calls a point with fewer than 13 returns an ordinary point', () => {
    const [game1] = history([...anchored('H', ''), expedite(), rally({ wonBy: 'H', returns: 5 })]);
    expect(game1?.rows[0]?.said).toEqual({
      key: 'scoring.tabletennis.last.rally',
      vars: { side: 'A. Sharma' },
    });
  });
});

describe('tableTennisHistory: games, the match, and what has no words', () => {
  it('groups by game, the latest first, with the timeout after a game in the next one', () => {
    const groups = history([...GAME_ONE_11_7, timeout('A'), ...rallies('A')]);
    expect(groups.map((group) => group.heading)).toEqual([
      { key: 'scoring.tabletennis.gameHeading', vars: { game: 2 } },
      { key: 'scoring.tabletennis.gameHeading', vars: { game: 1 } },
    ]);
    expect(groups[0]?.rows.map((row) => row.score)).toEqual(['0–1', null]);
    expect(groups[1]?.rows[0]).toMatchObject({
      score: '11–7',
      said: { key: 'scoring.tabletennis.last.game', vars: { game: 1, side: 'A. Sharma' } },
    });
  });

  it('says the last point of the match as the match', () => {
    const [game3] = history(DECIDED_3_0);
    expect(game3?.rows[0]?.said).toEqual({
      key: 'scoring.tabletennis.last.match',
      vars: { side: 'A. Sharma' },
    });
  });

  it('says a game set whole as a set score under the game it set', () => {
    const [game1] = history([start(), summary(11, 7)]);
    expect(game1?.rows[0]?.said).toEqual({
      key: 'scoring.tabletennis.last.setScore',
      vars: { score: '11–7' },
    });
  });

  it('leaves the start’s server unsaid when the first point names none', () => {
    const [game1] = history([start(), rally({ wonBy: 'H' })]);
    expect(game1?.rows[1]?.said).toEqual({ key: 'scoring.tabletennis.last.startUnknownServer' });
  });

  // The web can record a removal (expulsion) that the umpire's ladder has no card for; the pad has no words for it.
  it('has no row for a card level the umpire’s ladder does not hold, nor for the organiser’s forfeit', () => {
    const forfeit: Spec = { type: 'core.forfeit', payload: { by: 'ent-away', reason: 'retired' } };
    const [game1] = history([...anchored('H', ''), sanction('A', 'expulsion'), forfeit]);
    expect(game1?.rows.map((row) => row.said.key)).toEqual([
      'scoring.tabletennis.last.rally',
      'scoring.tabletennis.last.start',
    ]);
  });
});

describe('doneOf: an event the pad has no words for', () => {
  const names = namesOf({
    first: {
      entrantId: 'ent-home',
      name: 'A. Sharma',
      kind: 'individual',
      members: [],
      lineup: [],
    },
    second: { entrantId: 'ent-away', name: 'L. Chen', kind: 'individual', members: [], lineup: [] },
  });
  const facts = { game: 1, after: { first: 0, second: 0 }, won: 'none' } as const;
  const envelope = (type: string, payload: unknown) => ({
    id: 'e',
    fixtureId: 'fx',
    seq: 1,
    type,
    payload,
    recordedAt: '2026-11-03T10:00:00.000Z',
    recordedBy: null,
  });

  it('is a timeout, a point or a card by someone who is neither side, and a void', () => {
    const stranger = 'ent-stranger';
    for (const [type, payload] of [
      ['tabletennis.timeout', { by: stranger }],
      ['tabletennis.rally', { wonBy: stranger }],
      ['tabletennis.sanction', { by: stranger, level: 'warning' }],
      ['core.void', { event_id: 'ev-1' }],
    ] as const) {
      expect(doneOf(envelope(type, payload), facts, names, null)).toBeNull();
    }
  });

  it('is a game score that names no numbers', () => {
    expect(doneOf(envelope('tabletennis.game.summary', {}), facts, names, null)).toBeNull();
  });
});
