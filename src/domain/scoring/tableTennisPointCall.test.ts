import { describe, expect, it } from 'vitest';
import { foldTableTennis } from '@/domain/scoring/tableTennisFold';
import { tableTennisPad, type TableTennisDisplay } from '@/domain/scoring/tableTennisPad';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  DOUBLES,
  SINGLES,
  anchored,
  ledgerOf,
  timeout,
  withCfg,
  type Seat,
  type Spec,
} from '../../../test/tableTennisLedger';

// Point calls for table tennis (owner, 2026-11-12 and 13): game point and match point, read off the engine by folding one
// more point for each side. The rule written out here is ITTF 2.6: a game is to 11, two clear (so 10-10 has no call and 11-10
// is only game point for the leader), a match the best of the games, and there is no cap. Top half = home.

/** The winners of a game that stands `h`-`a`: the sides trade points, then the one ahead takes the rest. */
const trade = (h: number, a: number): string =>
  'HA'.repeat(Math.min(h, a)) + (h > a ? 'H' : 'A').repeat(Math.abs(h - a));

/** A game won to 11 by `by`, the loser on `loser`. */
const gameWon = (by: Seat, loser: number): string => 'HA'.repeat(loser) + by.repeat(11 - loser);

/** A started match, home serving first, with the game under way standing `h`-`a` after `before` (earlier games' points). */
function standing(h: number, a: number, before = ''): readonly Spec[] {
  const winners = before + trade(h, a);
  return anchored(winners[0] === 'A' ? 'A' : 'H', winners.slice(1));
}

function display(specs: readonly Spec[], bootstrap: Bootstrap = SINGLES): TableTennisDisplay {
  const result = foldTableTennis({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
  });
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result.display;
}

const calls = (specs: readonly Spec[], bootstrap: Bootstrap = SINGLES) =>
  display(specs, bootstrap).calls;
const NONE = { first: null, second: null };

describe('table tennis point calls: game point', () => {
  it('calls game point for the side on 10 against 8, and for nobody else', () => {
    expect(calls(standing(10, 8))).toEqual({ first: 'game', second: null });
  });

  it('calls the bottom side on 10 against 8 the same', () => {
    expect(calls(standing(8, 10))).toEqual({ first: null, second: 'game' });
  });

  it('calls nobody at 10-10: two clear is needed, so no one point ends the game', () => {
    expect(calls(standing(10, 10))).toEqual(NONE);
  });

  it('calls the leader at 11-10, and not the side behind', () => {
    expect(calls(standing(11, 10))).toEqual({ first: 'game', second: null });
    expect(calls(standing(10, 11))).toEqual({ first: null, second: 'game' });
  });

  it('calls nobody at 9-9, 0-0 or deep in deuce at 25-25: there is no cap', () => {
    for (const [h, a] of [
      [9, 9],
      [0, 0],
      [25, 25],
    ] as const)
      expect(calls(standing(h, a)), `${h}-${a}`).toEqual(NONE);
  });

  it('calls the leader at 26-25 of a long deuce', () => {
    expect(calls(standing(26, 25))).toEqual({ first: 'game', second: null });
  });

  it('calls a doubles match alike', () => {
    expect(calls(standing(10, 8), DOUBLES)).toEqual({ first: 'game', second: null });
  });

  it('keeps the call through a timeout, which scores nothing', () => {
    expect(calls([...standing(10, 8), timeout('A')])).toEqual({ first: 'game', second: null });
  });
});

describe('table tennis point calls: match point', () => {
  it('calls match point for the side two games up on 10-8 in game 3 of 5', () => {
    const before = gameWon('H', 5) + gameWon('H', 7);
    expect(calls(standing(10, 8, before))).toEqual({ first: 'match', second: null });
  });

  it('calls the side two games down only game point at 10-8 in game 3 of 5: its point takes the game, not the match', () => {
    const before = gameWon('H', 5) + gameWon('H', 7);
    // Away's point takes game 3 but away is two games down: game point, never match point.
    expect(calls(standing(8, 10, before))).toEqual({ first: null, second: 'game' });
  });

  it('calls game point, not match point, one game up in a best of 5', () => {
    expect(calls(standing(10, 8, gameWon('H', 5)))).toEqual({ first: 'game', second: null });
  });

  it('calls match point in the deciding game of a best of 5, at 2-2, for the side on 10', () => {
    const before = gameWon('H', 5) + gameWon('A', 6) + gameWon('H', 7) + gameWon('A', 8);
    expect(calls(standing(10, 9, before))).toEqual({ first: 'match', second: null });
    expect(calls(standing(9, 10, before))).toEqual({ first: null, second: 'match' });
  });

  it('calls both sides nothing at 10-10 of a deciding game', () => {
    const before = gameWon('H', 5) + gameWon('A', 6) + gameWon('H', 7) + gameWon('A', 8);
    expect(calls(standing(10, 10, before))).toEqual(NONE);
  });

  it('calls a best of 7 at 3-3 in game 7: six games over, match point for the side on 10', () => {
    const before =
      gameWon('H', 5) +
      gameWon('A', 6) +
      gameWon('H', 7) +
      gameWon('A', 8) +
      gameWon('H', 9) +
      gameWon('A', 4);
    const bestOfSeven = withCfg(SINGLES, { bestOf: 7 });
    const shown = display(standing(10, 8, before), bestOfSeven);
    expect(shown.finished).toHaveLength(6);
    expect(shown.calls).toEqual({ first: 'match', second: null });
  });

  it('calls a best of 1 at 10-8 match point', () => {
    expect(calls(standing(10, 8), withCfg(SINGLES, { bestOf: 1 }))).toEqual({
      first: 'match',
      second: null,
    });
  });

  it('calls a variant to 21 (hardbat) at 20, not 10: the target is the match’s own', () => {
    const hardbat = withCfg(SINGLES, { setTo: 21, finalSetTo: 21 });
    expect(calls(standing(20, 15), hardbat)).toEqual({ first: 'game', second: null });
    expect(calls(standing(10, 8), hardbat)).toEqual(NONE);
  });
});

describe('table tennis point calls: when nobody is called', () => {
  it('calls nothing before the start and between games', () => {
    expect(calls([])).toEqual(NONE);
    const over = display(standing(11, 7));
    expect(over.phase).toBe('betweenGames');
    expect(over.calls).toEqual(NONE);
  });

  it('calls nothing once the match is decided', () => {
    const decided = display(standing(11, 7, gameWon('H', 5) + gameWon('H', 6)));
    expect(decided.phase).toBe('decided');
    expect(decided.calls).toEqual(NONE);
  });

  it('reads no fault from a healthy ledger', () => {
    expect(display(standing(10, 8)).callFault).toBeNull();
  });
});

describe('table tennis point calls: the pad’s halves', () => {
  const GAME = {
    text: { key: 'scoring.pad.call.gamePoint' },
    said: { key: 'scoring.pad.call.gamePoint' },
  };
  const MATCH = {
    text: { key: 'scoring.pad.call.matchPoint' },
    said: { key: 'scoring.pad.call.matchPoint' },
  };

  it('gives the game point plate to the half of the side called', () => {
    const [top, bottom] = tableTennisPad(display(standing(10, 8))).halves;
    expect(top?.call).toEqual(GAME);
    expect(bottom?.call).toBeNull();
  });

  it('gives the match point plate, in place of game point', () => {
    const before = gameWon('H', 5) + gameWon('H', 7);
    const [top] = tableTennisPad(display(standing(10, 8, before))).halves;
    expect(top?.call).toEqual(MATCH);
  });

  it('gives none to a half that takes no tap: a decided match, whatever calls it carries', () => {
    const decided = display(standing(11, 7, gameWon('H', 5) + gameWon('H', 6)));
    const called = { ...decided, calls: { first: 'game', second: 'game' } } as const;
    for (const half of tableTennisPad(called).halves) {
      expect(half.tappable).toBe(false);
      expect(half.call).toBeNull();
    }
  });

  it('gives none when a display names no calls', () => {
    const { calls: _calls, ...bare } = display(standing(10, 8));
    for (const half of tableTennisPad(bare).halves) expect(half.call).toBeNull();
  });
});
