import { describe, expect, it } from 'vitest';
import { display, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import {
  DOUBLES_NOAD_CFG,
  SINGLES,
  award,
  point,
  start,
  summary,
  withCfg,
} from '../../../test/tennisLedger';

// S2-7 Task 18 (rulings 238, 240): who won each game of the set under way, in play order, for the pad's numbered dots. The
// expected lists are written out from the sequence of games the test plays (ITF Rules of Tennis, 5: a game is four points
// with a lead, a set six games), never read from the fold.

describe('the winners of the games of the set under way', () => {
  it('is empty before a game is won', () => {
    expect(display([start()]).gameWins).toEqual([]);
    expect(display([start(), point('H'), point('A')]).gameWins).toEqual([]);
  });

  it('lists each game won, in play order, first side as top', () => {
    expect(display([start(), ...gamesOf('HAH')]).gameWins).toEqual(['first', 'second', 'first']);
  });

  it('counts an awarded game as a game won by the side it was awarded to (ruling 238)', () => {
    expect(display([start(), award('A'), ...gamesOf('H')]).gameWins).toEqual(['second', 'first']);
  });

  it('starts the next set empty once a set is won, and lists only the new set’s games', () => {
    const shown = display([start(), ...gamesOf('HHHHHH'), ...gamesOf('A')]);
    expect(shown.finished).toHaveLength(1);
    expect(shown.gameWins).toEqual(['second']);
    expect(display([start(), ...gamesOf('HHHHHH')]).gameWins).toEqual([]);
  });

  it('keeps every game of a set that reaches 6-6, twelve of them', () => {
    const shown = display([start(), ...gamesOf('HAHAHAHAHAHA')]);
    expect(shown.gameWins).toEqual([
      'first',
      'second',
      'first',
      'second',
      'first',
      'second',
      'first',
      'second',
      'first',
      'second',
      'first',
      'second',
    ]);
    expect(shown.breaker).toBe('tiebreak');
  });

  it('has none for a set entered by Set score, and counts on from the next set’s own games', () => {
    const shown = display([start(), summary(6, 3), ...gamesOf('A')]);
    expect(shown.finished).toHaveLength(1);
    expect(shown.gameWins).toEqual(['second']);
    expect(display([start(), summary(6, 3)]).gameWins).toEqual([]);
  });

  it('has none in a match tie-break (it has no games)', () => {
    const shown = display([start(), summary(6, 3), summary(3, 6), point('H')], {
      bootstrap: withCfg(SINGLES, DOUBLES_NOAD_CFG),
    });
    expect(shown.breaker).toBe('matchTiebreak');
    expect(shown.gameWins).toEqual([]);
  });
});
