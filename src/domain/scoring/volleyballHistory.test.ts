import { describe, expect, it } from 'vitest';
import type { PadHistoryGroup } from '@/domain/scoring/padView';
import { foldVolleyball } from '@/domain/scoring/volleyballFold';
import type { VolleyballPadKey } from '@/domain/scoring/volleyballTypes';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  BEACH,
  INDOOR,
  judgedLedgerOf,
  queuedOf,
  rally,
  sanction,
  start,
  sub,
  summary,
  timeout,
  voiding,
  wholeSet,
  type Spec,
} from '../../../test/volleyballLedger';

// S2-6 Task 8 (ruling 183): History, one row for each event, in the one vocabulary the last-tap line speaks. The ledger is
// judged by the real engine; the rows are written out here from the spec.

type Groups = readonly PadHistoryGroup<VolleyballPadKey>[];

function historyOf(
  specs: readonly Spec[],
  bootstrap: Bootstrap = INDOOR,
  ledgerFrom: Bootstrap = bootstrap,
): Groups {
  const result = foldVolleyball({
    bootstrap,
    ledger: judgedLedgerOf(ledgerFrom, specs),
    queued: [],
    ownEventIds: [],
    toss: null,
  });
  if (result.kind !== 'folded') throw new Error(result.reason);
  return result.history;
}

const said = (groups: Groups) => groups.flatMap((g) => g.rows.map((r) => r.said));

describe('volleyball History: a row for each event', () => {
  it('says the start, a point, a timeout, a sub, a sanction and a set score, newest first in a set', () => {
    const groups = historyOf([
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      timeout('A'),
      sub('H', { off: 'h2', on: 'h7' }),
      sanction('A', 'warning', 'a3'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.heading).toEqual({ key: 'scoring.volleyball.setHeading', vars: { set: 1 } });
    expect(said(groups)).toEqual([
      {
        key: 'scoring.volleyball.last.sanction',
        vars: { level: { key: 'scoring.sanction.warning' }, person: 'Herons a3' },
      },
      {
        key: 'scoring.volleyball.last.subNamed',
        vars: { side: 'Falcons', off: 'Falcons h2', on: 'Falcons h7' },
      },
      { key: 'scoring.volleyball.last.timeout', vars: { side: 'Herons' } },
      { key: 'scoring.volleyball.last.rally', vars: { side: 'Falcons' } },
      { key: 'scoring.volleyball.last.start', vars: { side: 'Falcons' } },
    ]);
  });

  it('a point gives the score after it, top first; the others give none', () => {
    const rows = historyOf([
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      timeout('A'),
      rally({ wonBy: 'A' }),
    ])[0]!.rows;
    expect(rows.map((r) => r.score)).toEqual(['1–1', null, '1–0', null]);
  });

  it('a set score names itself, and a sub with no people says the side', () => {
    const groups = historyOf([start(), summary(10, 8), sub('A')]);
    expect(said(groups)).toEqual([
      { key: 'scoring.volleyball.last.sub', vars: { side: 'Herons' } },
      { key: 'scoring.volleyball.last.setScore', vars: { score: '10–8' } },
      { key: 'scoring.volleyball.last.startUnknownServer' },
    ]);
  });

  it('groups by set, the latest first; the deciding set’s first point also says who served first (toss)', () => {
    const groups = historyOf([
      start(),
      wholeSet(25, 20),
      wholeSet(20, 25),
      wholeSet(25, 20),
      wholeSet(20, 25),
      rally({ wonBy: 'A', serving: 'H' }),
    ]);
    expect(groups.map((g) => g.heading)).toEqual([
      { key: 'scoring.volleyball.setHeading', vars: { set: 5 } },
      { key: 'scoring.volleyball.setHeading', vars: { set: 4 } },
      { key: 'scoring.volleyball.setHeading', vars: { set: 3 } },
      { key: 'scoring.volleyball.setHeading', vars: { set: 2 } },
      { key: 'scoring.volleyball.setHeading', vars: { set: 1 } },
    ]);
    expect(groups[0]?.rows.map((r) => r.said)).toEqual([
      {
        key: 'scoring.volleyball.last.toss',
        vars: {
          point: { key: 'scoring.volleyball.last.rally', vars: { side: 'Herons' } },
          serving: 'Falcons',
        },
      },
    ]);
  });

  // I2 (batch B review): a rally carrying `serving` is the toss only as the deciding set's first point.
  const plainPoint = (side: string) => ({ key: 'scoring.volleyball.last.rally', vars: { side } });

  it('a set-2 opener carrying serving (the web’s 0–0 anchor) is a plain point, not a toss', () => {
    const groups = historyOf([start(), wholeSet(25, 20), rally({ wonBy: 'A', serving: 'H' })]);
    expect(groups[0]?.rows.map((r) => r.said)).toEqual([plainPoint('Herons')]);
  });

  it('a mid-set anchor in set 2 (a score given so far, then a rally naming the server) is a plain point', () => {
    const groups = historyOf([
      start(),
      wholeSet(25, 20),
      summary(5, 3),
      rally({ wonBy: 'H', serving: 'A' }),
    ]);
    expect(groups[0]?.rows[0]?.said).toEqual(plainPoint('Falcons'));
  });

  it('a mid-set anchor in the deciding set is a plain point; its opener is the toss', () => {
    const four = [start(), wholeSet(25, 20), wholeSet(20, 25), wholeSet(25, 20), wholeSet(20, 25)];
    const mid = historyOf([...four, summary(4, 2), rally({ wonBy: 'H', serving: 'A' })]);
    expect(mid[0]?.rows[0]?.said).toEqual(plainPoint('Falcons'));
    const opener = historyOf([...four, rally({ wonBy: 'H', serving: 'A' })]);
    expect(opener[0]?.rows[0]?.said).toEqual({
      key: 'scoring.volleyball.last.toss',
      vars: { point: plainPoint('Falcons'), serving: 'Herons' },
    });
  });

  it('beach’s deciding set is its third: the toss is the third set’s first point', () => {
    const toss = historyOf(
      [start(), wholeSet(21, 15), wholeSet(15, 21), rally({ wonBy: 'A', serving: 'H' })],
      BEACH,
    );
    expect(toss[0]?.rows[0]?.said).toMatchObject({ key: 'scoring.volleyball.last.toss' });
  });

  it('keeps an undone point in its place, marked undone', () => {
    const groups = historyOf([
      start(),
      rally({ wonBy: 'H', serving: 'H' }),
      timeout('A'),
      voiding(3),
    ]);
    const rows = groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.undone)).toEqual([true, false, false]);
    expect(rows[0]?.said).toEqual({
      key: 'scoring.volleyball.last.timeout',
      vars: { side: 'Herons' },
    });
  });

  it('marks this phone’s own queued tap as sending', () => {
    const result = foldVolleyball({
      bootstrap: INDOOR,
      ledger: judgedLedgerOf(INDOOR, [start()]),
      queued: [queuedOf('q1', timeout('H'))],
      ownEventIds: [],
      toss: null,
    });
    if (result.kind !== 'folded') throw new Error('did not fold');
    const row = result.history[0]?.rows[0];
    expect([row?.sending, row?.by]).toEqual([true, 'thisPhone']);
  });

  it('is empty for a match with nothing recorded (an empty input)', () => {
    expect(historyOf([])).toEqual([]);
  });
});

describe('volleyball History: a person the sheet no longer lists (ruling 183)', () => {
  // The ledger was judged with the full sheet; the bootstrap the phone holds now has lost h2 and h7 from its members.
  const gone: Bootstrap = {
    ...INDOOR,
    sides: {
      ...INDOOR.sides,
      home: {
        ...INDOOR.sides.home!,
        members: INDOOR.sides.home!.members.filter(
          (m) => m.personId !== 'h2' && m.personId !== 'h7',
        ),
      },
    },
  };

  it('reads "Player", never blank, in a sub and in a sanction', () => {
    const groups = historyOf(
      [start(), sub('H', { off: 'h2', on: 'h3' }), sanction('H', 'penalty', 'h7')],
      gone,
      INDOOR,
    );
    expect(said(groups)).toEqual([
      {
        key: 'scoring.volleyball.last.sanction',
        vars: {
          level: { key: 'scoring.sanction.penalty' },
          person: { key: 'scoring.volleyball.player' },
        },
      },
      {
        key: 'scoring.volleyball.last.subNamed',
        vars: { side: 'Falcons', off: { key: 'scoring.volleyball.player' }, on: 'Falcons h3' },
      },
      { key: 'scoring.volleyball.last.startUnknownServer' },
    ]);
  });
});
