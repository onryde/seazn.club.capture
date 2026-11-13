import { describe, expect, it } from 'vitest';
import { gamesOf } from '@/domain/scoring/tennisFold.testkit';
import { padOf } from '@/domain/scoring/tennisPad.testkit';
import {
  SINGLES,
  abandon,
  award,
  forfeit,
  interruption,
  point,
  sanction,
  start,
  summary,
  voiding,
} from '../../../test/tennisLedger';

// S2-7 Task 8: the pad's last-tap line speaks History's words (ruling 226), and Undo's line says what it took back.

const ANA = 'Ana Ruiz';
const BEA = 'Bea Lund';
const last = (...args: Parameters<typeof padOf>) => padOf(...args).lastTap?.text;

describe('the last-tap line', () => {
  it('is none before the start', () => {
    expect(padOf([]).lastTap).toBeNull();
  });

  it('says the start, then each tap in the one vocabulary', () => {
    expect(last([start()])).toEqual({ key: 'scoring.tennis.last.start' });
    expect(last([start(), point('H')])).toEqual({
      key: 'scoring.tennis.last.point',
      vars: { side: ANA },
    });
    expect(last([start(), ...gamesOf('A')])).toEqual({
      key: 'scoring.tennis.last.game',
      vars: { side: BEA },
    });
    expect(last([start(), summary(6, 4)])).toEqual({
      key: 'scoring.tennis.last.setScore',
      vars: { score: '6–4' },
    });
    expect(last([start(), award('H')])).toEqual({
      key: 'scoring.tennis.last.award',
      vars: { side: ANA },
    });
    expect(last([start(), interruption('toilet')])).toEqual({
      key: 'scoring.tennis.last.break',
      vars: { kind: { key: 'scoring.tennis.break.kind.toilet' } },
    });
  });

  it('offers Undo only when this phone has a tap to take back', () => {
    expect(padOf([start(), point('H')]).lastTap?.undo).toBe(false);
  });

  it('after an Undo says what was taken back, by side and by level', () => {
    expect(last([start(), point('A'), voiding(2)])).toEqual({
      key: 'scoring.tennis.undone.point',
      vars: { side: BEA },
    });
    expect(last([start(), sanction('H', 'warning'), voiding(2)])).toEqual({
      key: 'scoring.tennis.undone.violation',
      vars: { level: { key: 'scoring.tennis.level.warning' }, person: ANA },
    });
    expect(last([start(), award('A'), voiding(2)])).toEqual({
      key: 'scoring.tennis.undone.award',
      vars: { side: BEA },
    });
    expect(last([start(), interruption('heat'), voiding(2)])).toEqual({
      key: 'scoring.tennis.undone.break',
    });
    expect(last([start(), summary(6, 4), voiding(2)])).toEqual({
      key: 'scoring.tennis.undone.setScore',
    });
  });

  it('an Undo of the start shows no line (it returns to the Start screen)', () => {
    expect(padOf([start(), voiding(1)]).lastTap).toBeNull();
  });

  it('the organiser’s ending is the last tap too, in the card’s own words', () => {
    expect(last([start(), point('H'), forfeit('A', 'retired')])).toEqual({
      key: 'scoring.tennis.ending.by',
      vars: { ending: { key: 'scoring.tennis.ending.retired' }, side: BEA },
    });
    expect(last([start(), point('H'), abandon('rain')])).toEqual({
      key: 'scoring.tennis.ending.abandoned',
    });
  });

  it('a violation names the level and the player or side', () => {
    expect(last([start(), sanction('A', 'game_penalty')])).toEqual({
      key: 'scoring.tennis.last.violation',
      vars: { level: { key: 'scoring.tennis.level.gamePenalty' }, person: BEA },
    });
    expect(SINGLES.sides.home?.name).toBe(ANA);
  });
});
