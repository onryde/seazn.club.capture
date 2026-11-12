import { describe, expect, it } from 'vitest';
import { display, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import { parseTennisTool, tennisSetScoreOffered, tennisTools } from '@/domain/scoring/tennisTools';
import {
  DOUBLES,
  DOUBLES_NOAD_CFG,
  abandon,
  forfeit,
  point,
  points,
  sanction,
  start,
  withCfg,
} from '../../../test/tennisLedger';

// S2-7 Task 6 (rulings 219, 221, 228, 231, 232): the four cells always fill the row, Violation · Break · Award game · Set
// score. Set score stays, disabled, once the set has a point; Award game stays, disabled, in a breaker. Nothing is removed,
// so nothing moves under the scorer's thumb (volleyball F3). The displays are the real engine's folds of literal ledgers.

const IDS = ['violation', 'break', 'award', 'setScore'];
const idsOf = (shown: ReturnType<typeof display>) => tennisTools(shown).map((tool) => tool.id);
const enabled = (shown: ReturnType<typeof display>) =>
  Object.fromEntries(tennisTools(shown).map((tool) => [tool.id, tool.enabled]));

const SIX_ALL = 'HAHAHAHAHAHA';

describe('the tool row', () => {
  it('at 0-0 is Violation, Break, Award game, Set score, all usable', () => {
    const shown = display([start()]);
    expect(idsOf(shown)).toEqual(IDS);
    expect(enabled(shown)).toEqual({ violation: true, break: true, award: true, setScore: true });
  });

  it('after the set’s first point keeps the same four, in the same order, with Set score disabled', () => {
    const shown = display([start(), point('H')]);
    expect(idsOf(shown)).toEqual(IDS);
    expect(enabled(shown)).toEqual({ violation: true, break: true, award: true, setScore: false });
  });

  it('keeps Set score disabled when a game is won and the next has no point (the set has games)', () => {
    const shown = display([start(), ...gamesOf('H')]);
    expect(shown.call).toEqual({ first: '0', second: '0' });
    expect(enabled(shown).setScore).toBe(false);
  });

  it('offers Set score again in the next set at 0-0 (anti-vacuity: the rule is per set)', () => {
    const shown = display([start(), ...gamesOf('HHHHHH')]);
    expect(shown.set).toBe(2);
    expect(enabled(shown)).toEqual({ violation: true, break: true, award: true, setScore: true });
  });

  it('keeps Award game, disabled, in a tie-break (the engine refuses it there, ruling 219)', () => {
    const shown = display([start(), ...gamesOf(SIX_ALL)]);
    expect(shown.breaker).toBe('tiebreak');
    expect(idsOf(shown)).toEqual(IDS);
    expect(enabled(shown)).toEqual({
      violation: true,
      break: true,
      award: false,
      setScore: false,
    });
  });

  it('keeps Award game, disabled, in a match tie-break that has no point yet, with Set score offered', () => {
    const bootstrap = withCfg(DOUBLES, DOUBLES_NOAD_CFG);
    const shown = display([start(), ...gamesOf('HHHHHH'), ...gamesOf('AAAAAA')], { bootstrap });
    expect(shown.breaker).toBe('matchTiebreak');
    expect(enabled(shown)).toEqual({ violation: true, break: true, award: false, setScore: true });
  });

  it('has no tools before the start, once decided, once ended and while a default waits', () => {
    expect(tennisTools(display([]))).toEqual([]);
    expect(tennisTools(display([start(), ...gamesOf('HHHHHHHHHHHH')]))).toEqual([]);
    expect(tennisTools(display([start(), point('H'), forfeit('A', 'retired')]))).toEqual([]);
    expect(tennisTools(display([start(), point('H'), abandon('rain')]))).toEqual([]);
    const pending = display([start(), sanction('A', 'default')]);
    expect(pending.endingPending).toBe(true);
    expect(tennisTools(pending)).toEqual([]);
  });

  it('draws the short word where the full one does not fit a cell of four, and says the full one (ruling 232)', () => {
    const tools = tennisTools(display([start()]));
    const word = (id: string) => tools.find((tool) => tool.id === id);
    expect(word('violation')?.label).toEqual({ key: 'scoring.tennis.tool.violationShort' });
    expect(word('violation')?.said).toEqual({ key: 'scoring.tennis.tool.violation' });
    expect(word('award')?.label).toEqual({ key: 'scoring.tennis.tool.awardShort' });
    expect(word('award')?.said).toEqual({ key: 'scoring.tennis.tool.award' });
    expect(word('break')?.label).toEqual({ key: 'scoring.tennis.tool.break' });
    expect(word('setScore')?.label).toEqual({ key: 'scoring.tennis.tool.setScore' });
  });

  it('draws every cell as a plain outline with no second line', () => {
    for (const tool of tennisTools(display([start()])))
      expect([tool.kind, tool.detail]).toEqual(['standard', null]);
  });

  it('is the same four, in the same order, after a second call and with queued points on top', () => {
    const shown = display([start(), ...points('HAH')]);
    expect(idsOf(shown)).toEqual(IDS);
    expect(idsOf(shown)).toEqual(idsOf(shown));
  });
});

describe('Set score is offered before a set’s first point', () => {
  it('says so for 0-0 and not once the set has a point', () => {
    expect(tennisSetScoreOffered(display([start()]))).toBe(true);
    expect(tennisSetScoreOffered(display([start(), point('A')]))).toBe(false);
  });

  it('is not offered when the pad takes no tap', () => {
    expect(tennisSetScoreOffered(display([]))).toBe(false);
    expect(tennisSetScoreOffered(display([start(), point('H'), forfeit('H', 'retired')]))).toBe(
      false,
    );
  });
});

describe('parseTennisTool', () => {
  it('reads each id back and nothing else', () => {
    expect(parseTennisTool('violation')).toEqual({ violation: true });
    expect(parseTennisTool('break')).toEqual({ break: true });
    expect(parseTennisTool('award')).toEqual({ award: true });
    expect(parseTennisTool('setScore')).toEqual({ setScore: true });
    expect(parseTennisTool('more')).toBeNull();
    expect(parseTennisTool('')).toBeNull();
  });
});
