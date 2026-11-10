import type { CricketInningsCard } from '@seazn/engine/sports/cricket';
import { describe, expect, it } from 'vitest';
import { inningsHighlights } from '@/domain/scoring/cricketSummary';

// The result's summary (T19 fix 10): each innings' top bat, best bowl and extras off the engine's card. Cards are written
// by hand; every expectation is worked out from the rule (most runs, then fewer balls, then batting order; most wickets,
// then fewer runs, then fewer balls), never read back from the function.

const names = (id: string) => `Name ${id}`;
const bat = (order: number, runs: number, balls: number) =>
  ({
    order,
    person: `b${order}`,
    runs,
    balls,
    fours: null,
    sixes: null,
    strikeRate: null,
    dismissal: { kind: 'not_out' },
  }) as CricketInningsCard['batting'][number];
const bowl = (id: string, legalBalls: number, runs: number, wickets: number, overs: string) =>
  ({
    person: id,
    legalBalls,
    overs,
    maidens: 0,
    runs,
    wickets,
    economy: null,
    wides: null,
    noBalls: null,
  }) as CricketInningsCard['bowling'][number];
const card = (
  batting: CricketInningsCard['batting'],
  bowling: CricketInningsCard['bowling'],
  extras: CricketInningsCard['extras'] = null,
) => ({ batting, bowling, extras }) as CricketInningsCard;

describe('inningsHighlights', () => {
  it('top bat: most runs', () => {
    const got = inningsHighlights(card([bat(1, 12, 8), bat(2, 46, 11), bat(3, 30, 9)], []), names);
    expect(got.top).toStrictEqual({ name: 'Name b2', runs: 46, balls: 11 });
  });

  it('top bat: equal runs go to the fewer balls, then the earlier in the order', () => {
    expect(
      inningsHighlights(card([bat(1, 20, 14), bat(2, 20, 10), bat(3, 20, 10)], []), names).top,
    ).toStrictEqual({ name: 'Name b2', runs: 20, balls: 10 });
  });

  it('top bat: none when nobody faced a ball', () => {
    expect(inningsHighlights(card([bat(1, 0, 0), bat(2, 0, 0)], []), names).top).toBeNull();
  });

  it('top bat: a duck who faced a ball counts when nobody scored', () => {
    expect(inningsHighlights(card([bat(1, 0, 0), bat(2, 0, 3)], []), names).top).toStrictEqual({
      name: 'Name b2',
      runs: 0,
      balls: 3,
    });
  });

  it('best bowl: most wickets, then fewer runs, then fewer balls; shown as wickets-runs (overs)', () => {
    const got = inningsHighlights(
      card(
        [],
        [
          bowl('x', 12, 20, 1, '2'),
          bowl('y', 12, 15, 2, '2'),
          bowl('z', 6, 9, 2, '1'),
          bowl('w', 6, 9, 2, '1'),
        ],
      ),
      names,
    );
    expect(got.best).toStrictEqual({ name: 'Name z', wickets: 2, runs: 9, overs: '1' });
  });

  it('best bowl: equal wickets and runs go to the fewer balls, then the card order', () => {
    const got = inningsHighlights(
      card([], [bowl('x', 12, 9, 1, '2'), bowl('y', 6, 9, 1, '1'), bowl('z', 6, 9, 1, '1')]),
      names,
    );
    expect(got.best?.name).toBe('Name y');
  });

  it('best bowl: a wicket-taker beats any wicketless bowler, however tight', () => {
    const got = inningsHighlights(
      card([], [bowl('x', 12, 0, 0, '2'), bowl('y', 6, 30, 1, '1')]),
      names,
    );
    expect(got.best?.name).toBe('Name y');
  });

  it('best bowl: with no wicket, the lower economy; equal economy goes to the more balls', () => {
    // 0-3 in 3 balls and 0-6 in 6 balls are both 1.0 a ball: the 6-ball bowler.
    expect(
      inningsHighlights(card([], [bowl('c', 3, 3, 0, '0.3'), bowl('d', 6, 6, 0, '1')]), names).best
        ?.name,
    ).toBe('Name d');
    // 0-3 in 3 balls (1.0) against 0-5 in 6 (0.83): the 6-ball bowler.
    expect(
      inningsHighlights(card([], [bowl('c', 3, 3, 0, '0.3'), bowl('d', 6, 5, 0, '1')]), names).best
        ?.name,
    ).toBe('Name d');
    // Equal economy and balls: the card's order.
    expect(
      inningsHighlights(card([], [bowl('c', 6, 6, 0, '1'), bowl('d', 6, 6, 0, '1')]), names).best
        ?.name,
    ).toBe('Name c');
  });

  it('best bowl: none for a bowler-less innings, or one with no ball bowled', () => {
    expect(inningsHighlights(card([bat(1, 1, 1)], []), names).best).toBeNull();
    expect(inningsHighlights(card([], [bowl('x', 0, 1, 0, '0')]), names).best).toBeNull();
  });

  it('extras: the card’s own keys, a penalty named only when awarded; none in over totals', () => {
    const plain = { wides: 3, noBalls: 2, byes: 1, legByes: 1, penalties: 0, total: 7 };
    expect(inningsHighlights(card([], [], plain), names).extras).toStrictEqual({
      key: 'scoring.cricket.card.extras',
      vars: { total: 7, wides: 3, noBalls: 2, byes: 1, legByes: 1 },
    });
    const pen = { ...plain, penalties: 5, total: 12 };
    expect(inningsHighlights(card([], [], pen), names).extras?.key).toBe(
      'scoring.cricket.card.extrasPen',
    );
    expect(inningsHighlights(card([], [], null), names).extras).toBeNull();
  });

  it('extras: all zero reads just the total', () => {
    const none = { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalties: 0, total: 0 };
    expect(inningsHighlights(card([], [], none), names).extras).toStrictEqual({
      key: 'scoring.cricket.board.summary.extrasNone',
      vars: { total: 0 },
    });
  });
});
