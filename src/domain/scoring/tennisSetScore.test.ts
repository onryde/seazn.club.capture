import { describe, expect, it } from 'vitest';
import { display } from '@/domain/scoring/tennisFold.testkit';
import { setScoreAsksTiebreak, setScoreBounds } from '@/domain/scoring/tennisSetScore';
import type { TennisDisplay } from '@/domain/scoring/tennisTypes';
import {
  DOUBLES_NOAD_CFG,
  FAST4_CFG,
  GRAND_SLAM_CFG,
  SINGLES,
  start,
  summary,
  withCfg,
} from '../../../test/tennisLedger';

// S2-7 Task 9 (ruling 221): Set score's fields. The bounds are the engine's formulas (kernel `setGamesBound`: games to + win by
// + 2; `tbFieldBound`: tie-break to + win by + 2; a match tie-break's points to + 2), worked out here by hand.

const tour = display([start()]);
const fast4 = display([start()], { bootstrap: withCfg(SINGLES, FAST4_CFG) });
const decider = display([start(), summary(6, 4), summary(4, 6)], {
  bootstrap: withCfg(SINGLES, DOUBLES_NOAD_CFG),
});
const advantage = display([start()], {
  bootstrap: withCfg(SINGLES, {
    ...GRAND_SLAM_CFG,
    set: { gamesTo: 6, winBy: 2, tiebreakAt: null, tiebreakTo: 7 },
  }),
});

describe('the bounds', () => {
  it('Tour: games 6 + 2 + 2 = 10, tie-break 7 + 2 + 2 = 11', () => {
    expect(setScoreBounds(tour)).toEqual({ games: 10, tiebreak: 11 });
  });

  it('Fast4: games 4 + 2 + 2 = 8, tie-break 5 + 1 + 2 = 8', () => {
    expect(setScoreBounds(fast4)).toEqual({ games: 8, tiebreak: 8 });
  });

  it('a match tie-break of 10 lifts the games field to 12 (its points ride in it)', () => {
    expect(setScoreBounds(decider).games).toBe(12);
  });

  it('an advantage set has no ceiling but a sentinel (200)', () => {
    expect(setScoreBounds(advantage).games).toBe(200);
  });

  it('a config the engine refuses has nothing to enter, and no throw', () => {
    const broken = { ...tour, cfg: { bestOf: 'many' } } as unknown as TennisDisplay;
    expect(setScoreBounds(broken)).toEqual({ games: 0, tiebreak: 0 });
  });
});

describe('when the games ask for the tie-break’s points', () => {
  it('7–6 and 6–7 do, in Tour; 6–4, 7–5 and 6–6 do not', () => {
    expect(setScoreAsksTiebreak(tour, 7, 6)).toBe(true);
    expect(setScoreAsksTiebreak(tour, 6, 7)).toBe(true);
    expect(setScoreAsksTiebreak(tour, 6, 4)).toBe(false);
    expect(setScoreAsksTiebreak(tour, 7, 5)).toBe(false);
    expect(setScoreAsksTiebreak(tour, 6, 6)).toBe(false);
  });

  it('Fast4’s tie-break is at 3–3, so 4–3 asks and 7–6 does not', () => {
    expect(setScoreAsksTiebreak(fast4, 4, 3)).toBe(true);
    expect(setScoreAsksTiebreak(fast4, 7, 6)).toBe(false);
  });

  it('a match tie-break decider never does: 10–9 is points', () => {
    expect(setScoreAsksTiebreak(decider, 7, 6)).toBe(false);
    expect(setScoreAsksTiebreak(decider, 10, 9)).toBe(false);
  });

  it('an advantage set never does', () => {
    expect(setScoreAsksTiebreak(advantage, 7, 6)).toBe(false);
  });

  it('a config the engine refuses never does, and no throw', () => {
    const broken = { ...tour, cfg: { bestOf: 'many' } } as unknown as TennisDisplay;
    expect(setScoreAsksTiebreak(broken, 7, 6)).toBe(false);
  });
});
