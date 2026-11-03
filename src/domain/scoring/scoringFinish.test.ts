import { describe, expect, it } from 'vitest';
import { finishOf } from '@/domain/scoring/scoringFinish';
import { openMatch } from '@/domain/scoring/scoringMatch';
import type { MatchState } from '@/domain/scoring/scoringMatchState';
import type { LedgerEvent } from '@/domain/scoring/wire';
import {
  DECIDED_MATCH as DECIDED,
  GAME_ONE_21_15 as GAME_ONE,
  SINGLES,
  ledgerOf,
  rallies,
  start,
  type Spec,
} from '../../../test/badmintonLedger';
import { firstTo3, type FirstTo3 } from '../../../test/firstTo3Sport';
import { NOW, held, queueOf } from '../../../test/scoringMatchFixtures';

// Whether a saved match is over, as the pad itself would say it opened from the phone's own files with no signal
// (owner ruling 41, 2026-11-02: "if match is decided then can we say continue or close?"): the sport's own `decided`
// on the folded match, or the server's own word that it was finalized. Expectations are written out by hand.

/** A match opened from the files, nothing read since: the cold state the pad itself starts from. */
const cold = (specs: readonly Spec[], over: Parameters<typeof held>[0] = {}): MatchState =>
  openMatch({ ...held(over), ledger: ledgerOf(specs) }, NOW).state;

describe('finishOf', () => {
  it('is not finished before the match starts', () => {
    expect(finishOf(cold([]))).toBeNull();
  });

  it('is not finished while a game is under way, with a game already over', () => {
    expect(finishOf(cold([...GAME_ONE, ...rallies('HAH')]))).toBeNull();
  });

  it('is finished once the sport says the match is decided, with its games as the score', () => {
    expect(finishOf(cold(DECIDED))).toEqual({ score: '21–15, 21–18' });
  });

  it('is finished when the server finalized it, whatever the ledger folds to, with the games over', () => {
    const finalized = { ...SINGLES, status: 'finalized' };
    expect(finishOf(cold(GAME_ONE, { bootstrap: finalized }))).toEqual({ score: '21–15' });
    expect(finishOf(cold([start()], { bootstrap: finalized }))).toEqual({ score: '' });
  });

  it('is finished when the queue file says it was finalized, as a finalize leaves it', () => {
    const queue = queueOf({ dead: 'finalized' });
    expect(finishOf(cold(GAME_ONE, { queue }))).toEqual({ score: '21–15' });
  });

  it('is not finished when it was cancelled: nothing was decided, and there is no score to show', () => {
    const cancelled = { ...SINGLES, status: 'cancelled' };
    expect(finishOf(cold(GAME_ONE, { bootstrap: cancelled }))).toBeNull();
    expect(finishOf(cold(GAME_ONE, { queue: queueOf({ dead: 'cancelled' }) }))).toBeNull();
  });

  it('is not finished when the link is gone, which says nothing of the match', () => {
    expect(finishOf(cold(GAME_ONE, { queue: queueOf({ dead: 'LINK_REVOKED' }) }))).toBeNull();
  });

  it('cannot be known with no bootstrap held, even from a ledger that would fold to a result', () => {
    expect(finishOf(cold(DECIDED, { bootstrap: null }))).toBeNull();
  });

  it('is never judged on another sport’s bootstrap, finalized or not', () => {
    const other = { ...SINGLES, sportKey: 'tennis', status: 'finalized' };
    expect(finishOf(cold(DECIDED, { bootstrap: other }))).toBeNull();
  });
});

describe('finishOf, for a sport of another kind', () => {
  const point = (seq: number): LedgerEvent => ({
    id: `ev-${seq}`,
    seq,
    type: 'first3.point',
    payload: { side: 'first' },
    recordedAt: '2026-11-02T09:00:00.000Z',
    voids: null,
    deviceLinkId: null,
  });
  const boot = { ...SINGLES, sportKey: 'first3', cfg: {} };
  const first3 = (ledger: readonly LedgerEvent[]) =>
    openMatch<FirstTo3>(
      {
        sport: firstTo3,
        queue: queueOf(),
        ledger,
        bootstrap: boot,
        toss: null,
        judge: 'fold',
        foreground: true,
        rulesVersion: 1,
        decidedAt: null,
      },
      NOW,
    ).state;

  it('asks that sport, and writes the score as that sport does', () => {
    expect(finishOf(first3([point(1), point(2)]))).toBeNull();
    expect(finishOf(first3([point(1), point(2), point(3)]))).toEqual({ score: '3–0' });
  });
});
