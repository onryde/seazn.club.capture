import { describe, expect, it } from 'vitest';
import { display, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import {
  parseTennisTool,
  tennisSetScoreOffered,
  tennisToolSlots,
  tennisTools,
} from '@/domain/scoring/tennisTools';
import {
  DOUBLES,
  DOUBLES_NOAD_CFG,
  abandon,
  forfeit,
  point,
  points,
  sanction,
  start,
  summary,
  award,
  withCfg,
} from '../../../test/tennisLedger';

// S2-7 Task 6 (rulings 219, 221, 228, 231, 232) and Task 18 (ruling 241): the four cells fill the row, Violation · Break ·
// Award game · Set score, until the match has a point. Then Set score is REMOVED (not disabled) and the three that are left
// share the row; Award game stays, disabled, in a breaker. The row changes once, at the match's first point, so nothing moves
// under the scorer's thumb mid-set (volleyball F3). The displays are the real engine's folds of literal ledgers.

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

  it('after the match’s first point is Violation, Break, Award game: Set score is removed, not disabled (ruling 241)', () => {
    const shown = display([start(), point('H')]);
    expect(idsOf(shown)).toEqual(['violation', 'break', 'award']);
    expect(enabled(shown)).toEqual({ violation: true, break: true, award: true });
  });

  it('keeps the three through the match: a game won, the next set at 0-0, and a set that is 6-6', () => {
    for (const specs of [
      [start(), ...gamesOf('H')],
      [start(), ...gamesOf('HHHHHH')],
      [start(), ...gamesOf(SIX_ALL)],
    ])
      expect(idsOf(display(specs))).toEqual(['violation', 'break', 'award']);
    expect(display([start(), ...gamesOf('HHHHHH')]).set).toBe(2);
  });

  it('keeps Set score before any point even after an awarded game is refused it: the set has a game, so it is gone', () => {
    // An awarded game is not a point, but the set has a game (the engine refuses a set score then): Set score is disabled.
    const shown = display([start(), award('H')]);
    expect(idsOf(shown)).toEqual(IDS);
    expect(enabled(shown).setScore).toBe(false);
  });

  it('still offers Set score in the next set when the sets so far were entered by Set score (no point played)', () => {
    const shown = display([start(), summary(6, 3)]);
    expect(idsOf(shown)).toEqual(IDS);
    expect(enabled(shown).setScore).toBe(true);
  });

  it('keeps Award game, disabled, in a tie-break (the engine refuses it there, ruling 219)', () => {
    const shown = display([start(), ...gamesOf(SIX_ALL)]);
    expect(shown.breaker).toBe('tiebreak');
    expect(idsOf(shown)).toEqual(['violation', 'break', 'award']);
    expect(enabled(shown)).toEqual({ violation: true, break: true, award: false });
  });

  it('keeps Award game, disabled, in a match tie-break; Set score is offered only if sets were entered with no point', () => {
    const bootstrap = withCfg(DOUBLES, DOUBLES_NOAD_CFG);
    const played = display([start(), ...gamesOf('HHHHHH'), ...gamesOf('AAAAAA')], { bootstrap });
    expect(played.breaker).toBe('matchTiebreak');
    expect(enabled(played)).toEqual({ violation: true, break: true, award: false });
    const entered = display([start(), summary(6, 3), summary(3, 6)], { bootstrap });
    expect(enabled(entered)).toEqual({
      violation: true,
      break: true,
      award: false,
      setScore: true,
    });
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

  it('is the same three, in the same order, after a second call and with queued points on top', () => {
    const shown = display([start(), ...points('HAH')]);
    expect(idsOf(shown)).toEqual(['violation', 'break', 'award']);
    expect(idsOf(shown)).toEqual(idsOf(shown));
  });
});

describe('Set score is offered before a set’s first point', () => {
  it('says so for 0-0 and not once the set has a point', () => {
    expect(tennisSetScoreOffered(display([start()]))).toBe(true);
    expect(tennisSetScoreOffered(display([start(), point('A')]))).toBe(false);
    expect(tennisSetScoreOffered(display([start(), ...gamesOf('HHHHHH')]))).toBe(false);
  });

  it('is not offered when the pad takes no tap', () => {
    expect(tennisSetScoreOffered(display([]))).toBe(false);
    expect(tennisSetScoreOffered(display([start(), point('H'), forfeit('H', 'retired')]))).toBe(
      false,
    );
  });
});

describe('the row’s slots', () => {
  it('are four until the match has a point, then three: the row is re-divided once, at the first point', () => {
    expect(tennisToolSlots(display([start()]))).toBe(4);
    expect(tennisToolSlots(display([start(), summary(6, 3)]))).toBe(4);
    expect(tennisToolSlots(display([start(), point('H')]))).toBe(3);
    expect(tennisToolSlots(display([]))).toBe(4);
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
