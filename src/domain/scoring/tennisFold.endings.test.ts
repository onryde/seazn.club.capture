import { describe, expect, it } from 'vitest';
import { display, folded, gamesOf } from '@/domain/scoring/tennisFold.testkit';
import {
  abandon,
  forfeit,
  point,
  queuedOf,
  sanction,
  start,
  voiding,
} from '../../../test/tennisLedger';

// S2-7 Task 4 (ruling 225; G1, G2): the organiser ends a match short and the pad names how, never "Drawn" or nothing.
// The side of an ending is the side at fault: the one that retired, was defaulted, did not turn up or withdrew.

describe("the organiser's endings", () => {
  it('a retirement names the retiring side', () => {
    const shown = display([start(), ...gamesOf('H'), forfeit('A', 'retired')]);
    expect(shown.ending).toEqual({ kind: 'retired', side: 'second' });
    expect(shown.phase).toBe('ended');
  });

  it('a disqualification is defaulted, against the disqualified side', () => {
    expect(display([start(), forfeit('H', 'disqualified')]).ending).toEqual({
      kind: 'defaulted',
      side: 'first',
    });
  });

  it('a withdrawal is withdrew (G2)', () => {
    expect(display([start(), forfeit('A', 'withdrew')]).ending).toEqual({
      kind: 'withdrew',
      side: 'second',
    });
  });

  it('a walkover names the side that did not play', () => {
    expect(display([start(), forfeit('A', 'walkover')]).ending).toEqual({
      kind: 'walkover',
      side: 'second',
    });
  });

  it('a forfeit by both is a walkover with no side (G2)', () => {
    const both = { type: 'core.forfeit', payload: { by: 'both', reason: 'walkover' } };
    const shown = display([start(), both]);
    expect(shown.ending).toEqual({ kind: 'walkover', side: null });
    expect(shown.phase).toBe('ended');
  });

  it('an abandon is abandoned, with no side', () => {
    const shown = display([start(), point('H'), abandon('rain')]);
    expect(shown.ending).toEqual({ kind: 'abandoned', side: null });
    expect(shown.phase).toBe('ended');
  });

  it('a match won on court has no ending and is decided', () => {
    const shown = display([start(), ...gamesOf('HHHHHHHHHHHH')]);
    expect(shown.ending).toBeNull();
    expect(shown.phase).toBe('decided');
  });

  it('a match in play has no ending', () => {
    expect(display([start(), point('H')]).ending).toBeNull();
  });
});

describe('a default waiting for its forfeit (G1)', () => {
  it('a web default with no forfeit leaves the ending pending, the match still live', () => {
    const shown = display([start(), sanction('H', 'default')]);
    expect(shown.endingPending).toBe(true);
    expect(shown.phase).toBe('live');
    expect(shown.ending).toBeNull();
  });

  it('a warning, a point penalty and a game penalty are not an ending', () => {
    for (const level of ['warning', 'point_penalty', 'game_penalty']) {
      expect(display([start(), sanction('H', level)]).endingPending).toBe(false);
    }
  });

  it('the forfeit that follows ends it: no longer pending, defaulted', () => {
    const shown = display([start(), sanction('H', 'default'), forfeit('H', 'disqualified')]);
    expect(shown.endingPending).toBe(false);
    expect(shown.ending).toEqual({ kind: 'defaulted', side: 'first' });
  });

  it('a default the organiser undid is not pending', () => {
    expect(display([start(), sanction('H', 'default'), voiding(2)]).endingPending).toBe(false);
  });

  it('every point queued behind a pending default is refused by the engine', () => {
    const result = folded([start(), sanction('H', 'default')], {
      queued: [queuedOf('p', point('A'))],
    });
    expect(result.legalQueued).toEqual([]);
  });
});
