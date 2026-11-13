import { describe, expect, it } from 'vitest';
import { foldBadminton } from '@/domain/scoring/badmintonFold';
import { badmintonPad, type BadmintonDisplay } from '@/domain/scoring/badmintonPad';
import type { Bootstrap } from '@/domain/scoring/wire';
import {
  DOUBLES,
  SINGLES,
  ledgerOf,
  queuedOf,
  rally,
  rallies,
  start,
  summary,
  voiding,
  type Spec,
} from '../../../test/badmintonLedger';

// Point calls for badminton (owner, 2026-11-12 and 13): game point, match point and the BWF golden point at 29-29, read off
// the engine by folding one more point for each side. Every expectation is the rule of badminton written out (BWF 7.3: a game
// is to 21, two clear, and at 29-29 the side to 30 wins), never computed by the helper. Top half = home = `first`.

/** The winners of a game that stands `h`-`a`, the sides trading points, then the one ahead taking the rest. */
function trade(h: number, a: number): string {
  const level = Math.min(h, a);
  return 'HA'.repeat(level) + (h > a ? 'H' : 'A').repeat(Math.abs(h - a));
}

/** A game won by the top side to `a`: 21-a. */
const gameWon = (by: 'H' | 'A', loser: number): string => {
  const traded = 'HA'.repeat(loser);
  return traded + by.repeat(21 - loser);
};

/** A started match with game 1 of 3 standing `h`-`a`; the first rally names home serving. */
const standing = (h: number, a: number, before = ''): readonly Spec[] => [
  start(),
  rally('H', 'H'),
  ...rallies((before + trade(h, a)).slice(1)),
];

function calls(specs: readonly Spec[], more: { bootstrap?: Bootstrap; cfg?: unknown } = {}) {
  const bootstrap =
    more.cfg === undefined ? (more.bootstrap ?? SINGLES) : { ...SINGLES, cfg: more.cfg };
  const result = foldBadminton({
    bootstrap,
    ledger: ledgerOf(specs),
    queued: [],
    ownEventIds: [],
    toss: null,
  });
  if (result.kind !== 'folded') throw new Error(`did not fold: ${result.reason}`);
  return result.display;
}

const NONE = { first: null, second: null };

describe('badminton point calls: game point', () => {
  it('calls game point for the side on 20 against 17, and for nobody else', () => {
    expect(calls(standing(20, 17)).calls).toEqual({ first: 'game', second: null });
  });

  it('calls the bottom side on 20 against 18 the same: the half is the side’s', () => {
    expect(calls(standing(18, 20)).calls).toEqual({ first: null, second: 'game' });
  });

  it('calls nobody at 20-20: neither side wins the game with the next point (two clear)', () => {
    expect(calls(standing(20, 20)).calls).toEqual(NONE);
  });

  it('calls the leader at 21-20, and not the side behind: its point only levels the game', () => {
    expect(calls(standing(21, 20)).calls).toEqual({ first: 'game', second: null });
  });

  it('calls nobody early: 10-9, 0-0 and 19-19 take two points to win', () => {
    for (const [h, a] of [
      [10, 9],
      [0, 0],
      [19, 19],
    ] as const)
      expect(calls(standing(h, a)).calls, `${h}-${a}`).toEqual(NONE);
  });

  it('calls a 15-point game at 14, from the match’s own config: no 21 is ours', () => {
    const cfg = { bestOf: 3, setTo: 15, finalSetTo: 15, cap: 21 };
    expect(calls(standing(14, 10), { cfg }).calls).toEqual({ first: 'game', second: null });
    expect(calls(standing(14, 14), { cfg }).calls).toEqual(NONE);
    expect(calls(standing(20, 20), { cfg }).calls).toEqual({ first: 'golden', second: 'golden' });
  });

  it('calls a doubles match alike', () => {
    expect(calls(standing(20, 17), { bootstrap: DOUBLES }).calls).toEqual({
      first: 'game',
      second: null,
    });
  });
});

describe('badminton point calls: the golden point', () => {
  it('calls both sides at 29-29: the next point wins the game whoever takes it (BWF 7.3)', () => {
    expect(calls(standing(29, 29)).calls).toEqual({ first: 'golden', second: 'golden' });
  });

  it('calls only the leader at 29-28: the 30th point wins, but the trailing side’s only levels', () => {
    expect(calls(standing(29, 28)).calls).toEqual({ first: 'game', second: null });
  });

  it('does not call it at 28-28 (the game goes on to 30 or two clear) or 25-25', () => {
    expect(calls(standing(28, 28)).calls).toEqual(NONE);
    expect(calls(standing(25, 25)).calls).toEqual(NONE);
  });
});

describe('badminton point calls: match point', () => {
  it('calls match point, not game point, for the side a game up that can win game 2', () => {
    const game1 = gameWon('H', 15);
    expect(calls(standing(20, 10, game1)).calls).toEqual({ first: 'match', second: null });
  });

  it('calls game point only, for the side a game down: its point levels the match', () => {
    const game1 = gameWon('H', 15);
    expect(calls(standing(10, 20, game1)).calls).toEqual({ first: null, second: 'game' });
  });

  it('calls match point in a deciding game at 1-1 for the side on 20 against 15', () => {
    const games = gameWon('H', 15) + gameWon('A', 12);
    expect(calls(standing(20, 15, games)).calls).toEqual({ first: 'match', second: null });
    expect(calls(standing(15, 20, games)).calls).toEqual({ first: null, second: 'match' });
  });

  it('calls both sides match point at 29-29 of a deciding game: whoever takes the point wins the match', () => {
    const games = gameWon('H', 15) + gameWon('A', 12);
    expect(calls(standing(29, 29, games)).calls).toEqual({ first: 'match', second: 'match' });
  });

  it('calls the leader match and the other golden at 29-29 of game 2 with one game in hand: its point only wins a game', () => {
    const game1 = gameWon('H', 15);
    expect(calls(standing(29, 29, game1)).calls).toEqual({ first: 'match', second: 'golden' });
  });

  it('calls a best of 1 at 20-17 match point, a best of 5 at 2-1 up in game 4 match point', () => {
    expect(calls(standing(20, 17), { cfg: { bestOf: 1 } }).calls).toEqual({
      first: 'match',
      second: null,
    });
    const games = gameWon('H', 15) + gameWon('A', 15) + gameWon('H', 15);
    expect(calls(standing(20, 15, games), { cfg: { bestOf: 5 } }).calls).toEqual({
      first: 'match',
      second: null,
    });
    // One game up in a best of 5 is two short of the match: game point.
    expect(calls(standing(20, 15, gameWon('H', 15)), { cfg: { bestOf: 5 } }).calls).toEqual({
      first: 'game',
      second: null,
    });
  });
});

describe('badminton point calls: when nobody is called', () => {
  it('calls nothing before the start, before the first rally, and between games', () => {
    expect(calls([]).calls).toEqual(NONE);
    expect(calls([start()]).calls).toEqual(NONE);
    expect(calls(standing(21, 15)).phase).toBe('betweenGames');
    expect(calls(standing(21, 15)).calls).toEqual(NONE);
  });

  it('calls nothing once the match is decided', () => {
    const decided = standing(21, 15, gameWon('H', 15));
    const display = calls(decided);
    expect(display.phase).toBe('decided');
    expect(display.calls).toEqual(NONE);
  });

  it('follows the ledger as it is undone: a voided rally takes the call back', () => {
    const specs = standing(20, 17);
    expect(calls([...specs, voiding(specs.length)]).calls).toEqual(NONE);
  });

  it('counts a Set score the same as played rallies: 20-10 entered whole is game point', () => {
    expect(calls([start(), summary(20, 10)]).calls).toEqual({ first: 'game', second: null });
  });

  it('counts this phone’s queued rally on top of the ledger, as it counts it for the score', () => {
    const result = foldBadminton({
      bootstrap: SINGLES,
      ledger: ledgerOf(standing(19, 17)),
      queued: [queuedOf('k1', rally('H'))],
      ownEventIds: [],
      toss: null,
    });
    if (result.kind !== 'folded') throw new Error('did not fold');
    expect(result.display.points).toEqual({ first: 20, second: 17 });
    expect(result.display.calls).toEqual({ first: 'game', second: null });
  });

  it('judges only the new point strictly: a game score entered whole that the rules would not reach today still lets the call read', () => {
    // 25-10 is not a score a game to 21 reaches (it was over at 21-10), so the engine refuses it as a new event; a ledger that
    // already holds it replays tolerantly (a cfg edit must not brick a fixture). Reading the whole stream strictly would drop
    // every plate for that match. Game 2 then stands 20-17.
    const odd: Spec = { type: 'badminton.game.summary', payload: { home: 25, away: 10 } };
    const [first, ...rest] = standing(20, 17);
    const shown = calls([first as Spec, odd, ...rest]);
    expect(shown.finished).toHaveLength(1);
    expect(shown.points).toEqual({ first: 20, second: 17 });
    // The top side took game 1 on the entered score, so 20-17 in game 2 is match point.
    expect(shown.calls).toEqual({ first: 'match', second: null });
  });

  it('replays what the ledger already holds, and judges only the new point: a config edited since the rallies were recorded', () => {
    // The web's read path folds what was recorded without validating it again (a division whose config was edited must not
    // brick its fixtures); a strict reading of the whole stream would refuse the rallies played on after 15 under a game to 15, and the call is the new
    // point's to be judged, not the old ones'.
    const cfg = { bestOf: 3, setTo: 15, finalSetTo: 15, cap: 21 };
    const shown = calls(standing(17, 12), { cfg });
    // 15-12 closed game 1 for the top side (to 15), and the two rallies after it opened game 2 at 2-0: nobody is on 14.
    expect(shown.points).toEqual({ first: 2, second: 0 });
    expect(shown.calls).toEqual(NONE);
  });

  it('reads no fault from a healthy ledger', () => {
    expect(calls(standing(20, 17)).callFault).toBeNull();
  });
});

describe('badminton point calls: the pad’s halves', () => {
  const pad = (display: BadmintonDisplay) => badmintonPad(display).halves;
  const GAME = {
    text: { key: 'scoring.pad.call.gamePoint' },
    said: { key: 'scoring.pad.call.gamePoint' },
  };

  it('gives the plate to the half whose side is called, and none to the other', () => {
    const [top, bottom] = pad(calls(standing(20, 17)));
    expect(top?.call).toEqual(GAME);
    expect(bottom?.call).toBeNull();
  });

  it('gives both halves the golden plate at 29-29', () => {
    const halves = pad(calls(standing(29, 29)));
    for (const half of halves)
      expect(half.call).toEqual({
        text: { key: 'scoring.pad.call.goldenPoint' },
        said: { key: 'scoring.pad.call.goldenPoint' },
      });
  });

  it('gives no plate to a half that takes no tap: a disqualification waiting for its ending', () => {
    const display: BadmintonDisplay = { ...calls(standing(20, 17)), awaitingEnding: true };
    for (const half of pad(display)) {
      expect(half.tappable).toBe(false);
      expect(half.call).toBeNull();
    }
  });

  it('gives none while no calls are known (a display that names none)', () => {
    const { calls: _calls, ...bare } = calls(standing(20, 17));
    for (const half of pad(bare)) expect(half.call).toBeNull();
  });
});
