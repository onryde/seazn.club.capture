import { describe, expect, it } from 'vitest';
import { tennisCfgOf } from '@/domain/scoring/tennisEngine';
import { tennisRuleRows } from '@/domain/scoring/tennisRules';
import { DOUBLES_NOAD_CFG, FAST4_CFG, GRAND_SLAM_CFG, TOUR_CFG } from '../../../test/tennisLedger';

// S2-7 Task 6 (ruling 230): the Start screen's rules rows read the format's facts from the match's config as the engine
// reads it, never from a preset's name (7.0.0's config has none). Values are the presets' own, written out by hand.

const R = 'scoring.tennis.rules.';
const rowsOf = (raw: unknown) => {
  const cfg = tennisCfgOf(raw);
  if (cfg === null) throw new Error('cfg refused');
  return tennisRuleRows(cfg);
};

describe('the rules rows', () => {
  it('Tour: best of 3, games to 6, a tie-break at 6-6 to 7, nothing more', () => {
    expect(rowsOf(TOUR_CFG)).toEqual([
      { label: { key: `${R}format.label` }, value: { key: `${R}bestOf`, vars: { bestOf: 3 } } },
      { label: { key: `${R}set.label` }, value: { key: `${R}gamesTo`, vars: { gamesTo: 6 } } },
      {
        label: { key: `${R}tiebreak.label` },
        value: { key: `${R}tiebreakAt`, vars: { at: 6, to: 7 } },
      },
    ]);
  });

  it('Grand Slam: best of 5, and a final set with a tie-break at 6-6 to 10', () => {
    expect(rowsOf(GRAND_SLAM_CFG)).toEqual([
      { label: { key: `${R}format.label` }, value: { key: `${R}bestOf`, vars: { bestOf: 5 } } },
      { label: { key: `${R}set.label` }, value: { key: `${R}gamesTo`, vars: { gamesTo: 6 } } },
      {
        label: { key: `${R}tiebreak.label` },
        value: { key: `${R}tiebreakAt`, vars: { at: 6, to: 7 } },
      },
      {
        label: { key: `${R}finalSet.label` },
        value: { key: `${R}finalTiebreak`, vars: { at: 6, to: 10 } },
      },
    ]);
  });

  it('Fast4: games to 4, a tie-break at 3-3 to 5, no-ad', () => {
    expect(rowsOf(FAST4_CFG)).toEqual([
      { label: { key: `${R}format.label` }, value: { key: `${R}bestOf`, vars: { bestOf: 3 } } },
      { label: { key: `${R}set.label` }, value: { key: `${R}gamesTo`, vars: { gamesTo: 4 } } },
      {
        label: { key: `${R}tiebreak.label` },
        value: { key: `${R}tiebreakAt`, vars: { at: 3, to: 5 } },
      },
      { label: { key: `${R}game.label` }, value: { key: `${R}noAd` } },
    ]);
  });

  it('doubles no-ad: no-ad and a match tie-break to 10 as the final set', () => {
    expect(rowsOf(DOUBLES_NOAD_CFG)).toEqual([
      { label: { key: `${R}format.label` }, value: { key: `${R}bestOf`, vars: { bestOf: 3 } } },
      { label: { key: `${R}set.label` }, value: { key: `${R}gamesTo`, vars: { gamesTo: 6 } } },
      {
        label: { key: `${R}tiebreak.label` },
        value: { key: `${R}tiebreakAt`, vars: { at: 6, to: 7 } },
      },
      { label: { key: `${R}game.label` }, value: { key: `${R}noAd` } },
      {
        label: { key: `${R}finalSet.label` },
        value: { key: `${R}finalMatchTiebreak`, vars: { to: 10 } },
      },
    ]);
  });

  it('an advantage set (no tie-break at games-all) says None, and a final-set tie-break has none to play', () => {
    const advantage = { set: { gamesTo: 6, winBy: 2, tiebreakAt: null, tiebreakTo: 7 } };
    expect(rowsOf(advantage)[2]).toEqual({
      label: { key: `${R}tiebreak.label` },
      value: { key: `${R}noTiebreak` },
    });
    expect(rowsOf({ ...advantage, finalSet: { tiebreakTo: 10 } })).toHaveLength(3);
  });

  it('asks no serve question: no row is about the serve', () => {
    for (const cfg of [TOUR_CFG, GRAND_SLAM_CFG, FAST4_CFG, DOUBLES_NOAD_CFG])
      expect(JSON.stringify(rowsOf(cfg)).toLowerCase()).not.toContain('serv');
  });
});
