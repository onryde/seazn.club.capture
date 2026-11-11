import { tabletennis } from '@seazn/engine/sports/setbased';
import { describe, expect, it, vi } from 'vitest';
import { foldBadminton } from '@/domain/scoring/badmintonFold';
import { foldSetBased, type SetBasedKit } from '@/domain/scoring/setBasedFold';
import { foldTableTennis } from '@/domain/scoring/tableTennisFold';
import type { SportFoldInput } from '@/domain/scoring/scoringSport';
import {
  DOUBLES as BADMINTON_DOUBLES,
  ledgerOf as badmintonLedger,
  rally as badmintonRally,
  start as badmintonStart,
} from '../../../test/badmintonLedger';
import { DOUBLES, DOUBLES_NO_ORDER, ledgerOf, rally, start } from '../../../test/tableTennisLedger';

// S2-6 Task 4's declared shared change: `SetBasedKit.lineupsOf`, optional, defaulting to `lineupOf`. Badminton and table
// tennis give none, so each keeps folding with the lineup it always did (the pins below, written from the doubles
// server's rule in ITTF 2.13.3, not from the fold); a sport that gives one is asked once for each side.

const KIT_BASE: Pick<
  SetBasedKit<never>,
  'module' | 'rally' | 'summary' | 'mayAppend' | 'doneOf'
> = {
  module: tabletennis,
  rally: 'tabletennis.rally',
  summary: 'tabletennis.game.summary',
  mayAppend: () => true,
  doneOf: () => null,
};

const input: SportFoldInput = {
  bootstrap: DOUBLES,
  ledger: ledgerOf([start()]),
  queued: [],
  ownEventIds: [],
  toss: null,
};

describe('SetBasedKit.lineupsOf', () => {
  it('is asked for the home seat, then the away seat, and only then', () => {
    const lineupsOf = vi.fn((side: { readonly entrantId: string }) => ({
      entrantId: side.entrantId,
      slots: [],
    }));
    foldSetBased({ ...KIT_BASE, lineupsOf }, input);
    expect(lineupsOf.mock.calls.map(([side]) => side.entrantId)).toEqual(['ent-home', 'ent-away']);
  });

  it('table tennis, which gives none, still names the doubles server from the pair order', () => {
    const result = foldTableTennis({
      ...input,
      ledger: ledgerOf([start(), rally({ wonBy: 'H', serving: 'H' })]),
    });
    if (result.kind !== 'folded') throw new Error('did not fold');
    expect([result.display.server, result.display.serverPerson]).toEqual(['first', 'A. Sharma']);
  });

  it('table tennis names the away pair’s first named player when the away side serves first, and nobody with no pair order', () => {
    const awayServes = foldTableTennis({
      ...input,
      ledger: ledgerOf([start(), rally({ wonBy: 'A', serving: 'A' })]),
    });
    if (awayServes.kind !== 'folded') throw new Error('did not fold');
    expect([awayServes.display.server, awayServes.display.serverPerson]).toEqual([
      'second',
      'L. Chen',
    ]);
    const unordered = foldTableTennis({
      ...input,
      bootstrap: DOUBLES_NO_ORDER,
      ledger: ledgerOf([start(), rally({ wonBy: 'H', serving: 'H' })]),
    });
    if (unordered.kind !== 'folded') throw new Error('did not fold');
    expect(unordered.display.serverPerson).toBeNull();
  });

  // Badminton's display carries no person-level fact, so nothing it shows depends on the lineup (a mutant that hands the
  // engine empty lineups survives every badminton test, this one included): this pins only that the fold is unchanged.
  it('badminton, which gives none, still folds its doubles match as it did', () => {
    const result = foldBadminton({
      bootstrap: BADMINTON_DOUBLES,
      ledger: badmintonLedger([badmintonStart(), badmintonRally('H', 'H')]),
      queued: [],
      ownEventIds: [],
      toss: null,
    });
    if (result.kind !== 'folded') throw new Error('did not fold');
    expect([result.display.points, result.display.server]).toEqual([
      { first: 1, second: 0 },
      'first',
    ]);
  });
});
